const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fetch = require('node-fetch');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./config/db');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const {
    MAIN_DOMAIN,
    CLOUDFLARE_ZONE_ID,
    CLOUDFLARE_EMAIL,
    CLOUDFLARE_API_KEY,
    CLOUDFLARE_ACCOUNT_ID,
    createCNAMERecord,
    attachCustomDomain,
    createWranglerConfig,
    deleteDNSRecord,
    deleteCloudflarePages
} = require('./cloudflare');
const fsPromises = require('fs').promises;
const archiver = require('archiver');
const extract = require('extract-zip');
const CloudflareDeployer = require('./utils/cloudflare-redeploy');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Word lists for generating subdomains
const prefixes = ['my', 'our', 'the', 'cool', 'best', 'top'];
const words = ['site', 'page', 'app', 'code', 'web', 'hub', 'lab', 'dock', 'spot', 'zone', 'dev'];
const suffixes = ['pro', 'hub', 'lab', 'plus', 'dev'];

// Generate a random subdomain
function generateSubdomain() {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const word = words[Math.floor(Math.random() * words.length)];
    const useSuffix = Math.random() > 0.5;
    const suffix = useSuffix ? suffixes[Math.floor(Math.random() * suffixes.length)] : '';
    
    return `${prefix}${word}${suffix}`.toLowerCase();
}

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, uuidv4() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Initialize database
async function initializeDatabase() {
    try {
        // Create users table
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create sites table
        await db.query(`
            CREATE TABLE IF NOT EXISTS sites (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                subdomain VARCHAR(100) UNIQUE NOT NULL,
                project_name VARCHAR(255) NOT NULL,
                dns_record_id VARCHAR(255),
                preview_url TEXT,
                custom_domain_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Call initializeDatabase when server starts
initializeDatabase();

// Helper function to execute commands
async function executeCommand(command, cwd = process.cwd()) {
    console.log(`Executing command: ${command}`);
    const { stdout, stderr } = await execPromise(command, { cwd });
    if (stderr) console.error('Command stderr:', stderr);
    console.log('Command stdout:', stdout);
    return { stdout, stderr };
}

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Routes
app.get('/', (req, res) => {
    res.render('home');
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login');
});

app.get('/signup', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('signup');
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        // Fetch user's sites from database
        const result = await db.query(
            'SELECT subdomain, project_name, preview_url, custom_domain_url FROM sites WHERE user_id = $1 ORDER BY created_at DESC',
            [req.session.user.id]
        );

        // Count active sites
        const sitesCount = result.rows.length;

        res.render('dashboard', { 
            user: req.session.user,
            sites: result.rows,
            sitesCount: sitesCount
        });
    } catch (error) {
        console.error('Error fetching sites:', error);
        res.render('dashboard', { 
            user: req.session.user,
            sites: [],
            sitesCount: 0
        });
    }
});

app.get('/upload', (req, res) => {
    res.render('index');
});

// Add this utility function for pretty logging
function prettyLog(title, data) {
    console.log('\n\x1b[36m%s\x1b[0m', `=== ${title} ===`);
    if (data) {
        if (typeof data === 'string') {
            console.log(data);
        } else {
            console.log(JSON.stringify(data, null, 2));
        }
    }
    console.log('\x1b[36m%s\x1b[0m', '='.repeat(title.length + 8));
}

// Update the deploy route with detailed logging
app.post('/deploy', isAuthenticated, upload.fields([
    { name: 'zipFile', maxCount: 1 },
    { name: 'files', maxCount: 50 }
]), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        prettyLog('Starting Deployment Process', new Date().toISOString());

        // Validate subdomain
        const subdomain = req.body.subdomain ? req.body.subdomain.trim().toLowerCase() : '';
        if (!subdomain || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain)) {
            throw new Error('Invalid subdomain. Must start and end with a letter or number, and can only contain letters, numbers, and hyphens.');
        }

        prettyLog('Subdomain Validation', {
            subdomain: subdomain,
            valid: true
        });

        // Check if subdomain is available
        const subdomainCheck = await db.query(
            'SELECT id FROM sites WHERE subdomain = $1',
            [subdomain]
        );

        if (subdomainCheck.rows.length > 0) {
            throw new Error('Subdomain is already taken');
        }

        prettyLog('Subdomain Availability Check', {
            subdomain: subdomain,
            available: true
        });

        // Send initial progress
        res.write(`data: ${JSON.stringify({ stage: 1, message: 'Processing files...' })}\n\n`);

        let zipPath;
        const uploadDir = path.join(__dirname, 'uploads');
        const tempDir = path.join(__dirname, 'temp');

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Handle direct ZIP upload
        if (req.files.zipFile) {
            zipPath = req.files.zipFile[0].path;
            prettyLog('File Upload', {
                type: 'ZIP file',
                path: zipPath,
                size: fs.statSync(zipPath).size + ' bytes'
            });
            res.write(`data: ${JSON.stringify({ stage: 2, message: 'ZIP file received...' })}\n\n`);
        }
        // Handle multiple files upload
        else if (req.files.files) {
            prettyLog('File Upload', {
                type: 'Multiple files',
                count: req.files.files.length,
                files: req.files.files.map(f => ({ name: f.originalname, size: f.size + ' bytes' }))
            });
            res.write(`data: ${JSON.stringify({ stage: 2, message: 'Creating ZIP from files...' })}\n\n`);
            const tempZipPath = path.join(tempDir, `${uuidv4()}.zip`);
            const zip = new AdmZip();

            req.files.files.forEach(file => {
                const fileContent = fs.readFileSync(file.path);
                zip.addFile(file.originalname, fileContent);
                fs.unlinkSync(file.path);
            });

            zip.writeZip(tempZipPath);
            zipPath = tempZipPath;
            prettyLog('ZIP Creation', {
                path: zipPath,
                size: fs.statSync(zipPath).size + ' bytes'
            });
        } else {
            throw new Error('No files uploaded');
        }

        res.write(`data: ${JSON.stringify({ stage: 3, message: 'Preparing deployment...' })}\n\n`);

        // Modified deployToCloudflare function call with progress updates
        const deploymentResult = await (async () => {
            try {
                const projectName = `site-${Date.now()}`;
                const extractPath = path.join(__dirname, 'uploads', projectName, 'extract');
                const deployPath = path.join(__dirname, 'uploads', projectName, 'deploy');

                prettyLog('Project Setup', {
                    projectName,
                    extractPath,
                    deployPath
                });

                if (!fs.existsSync(extractPath)) fs.mkdirSync(extractPath, { recursive: true });
                if (!fs.existsSync(deployPath)) fs.mkdirSync(deployPath, { recursive: true });

                res.write(`data: ${JSON.stringify({ stage: 4, message: 'Extracting files...' })}\n\n`);
                prettyLog('Extracting ZIP', 'Starting extraction process...');
                await executeCommand(
                    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`
                );
                prettyLog('Extraction Complete', {
                    files: fs.readdirSync(extractPath)
                });

                // Add this new code to copy files to the user's site directory
                const userId = req.session.user.id;
                const userSitePath = path.join(__dirname, 'uploads', userId.toString(), subdomain);
                if (!fs.existsSync(userSitePath)) {
                    fs.mkdirSync(userSitePath, { recursive: true });
                }

                // Copy files to user's site directory
                await executeCommand(
                    `powershell -Command "Copy-Item -Path '${extractPath}\\*' -Destination '${userSitePath}' -Recurse -Force"`
                );
                prettyLog('Files Copied to User Directory', {
                    path: userSitePath,
                    files: fs.readdirSync(userSitePath)
                });

                res.write(`data: ${JSON.stringify({ stage: 5, message: 'Preparing files for deployment...' })}\n\n`);
                prettyLog('File Preparation', 'Copying files to deploy directory...');
                await executeCommand(
                    `powershell -Command "Copy-Item -Path '${extractPath}\\*' -Destination '${deployPath}' -Recurse -Force"`
                );

                const wranglerConfig = createWranglerConfig(subdomain);
                fs.writeFileSync(path.join(deployPath, 'wrangler.toml'), wranglerConfig);
                prettyLog('Wrangler Config', {
                    config: wranglerConfig,
                    path: path.join(deployPath, 'wrangler.toml')
                });

                res.write(`data: ${JSON.stringify({ stage: 6, message: 'Creating Cloudflare Pages project...' })}\n\n`);
                prettyLog('Cloudflare Project Creation', 'Creating new Pages project...');
                const projectResult = await executeCommand(
                    `npx wrangler pages project create ${projectName} --production-branch=main`,
                    deployPath
                );
                prettyLog('Project Creation Result', projectResult);

                res.write(`data: ${JSON.stringify({ stage: 7, message: 'Deploying to Cloudflare Pages...' })}\n\n`);
                prettyLog('Cloudflare Deployment', 'Starting deployment process...');
                const { stdout } = await executeCommand(
                    `npx wrangler pages deploy . --project-name=${projectName}`,
                    deployPath
                );
                prettyLog('Deployment Output', stdout);

                const pagesDevUrl = stdout.match(/https:\/\/[^\s]+\.pages\.dev/)?.[0];
                if (!pagesDevUrl) throw new Error('Could not find Pages URL in deployment output');

                prettyLog('Pages URL', {
                    url: pagesDevUrl
                });

                res.write(`data: ${JSON.stringify({ stage: 8, message: 'Configuring DNS...' })}\n\n`);
                prettyLog('DNS Configuration', 'Creating CNAME record...');
                const dnsRecordId = await createCNAMERecord(subdomain, pagesDevUrl.replace('https://', ''));
                prettyLog('DNS Record ID', dnsRecordId);

                res.write(`data: ${JSON.stringify({ stage: 9, message: 'Setting up custom domain...' })}\n\n`);
                const customDomain = `${subdomain}.${MAIN_DOMAIN}`;
                prettyLog('Custom Domain Setup', {
                    domain: customDomain
                });
                const domainResult = await attachCustomDomain(projectName, customDomain);
                prettyLog('Domain Attachment Result', domainResult);

                try {
                    fs.rmSync(path.join(__dirname, 'uploads', projectName), { recursive: true, force: true });
                    prettyLog('Cleanup', 'Temporary files removed successfully');
                } catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }

                return {
                    previewUrl: pagesDevUrl,
                    customDomainUrl: `https://${customDomain}`,
                    projectName: projectName,
                    dnsRecordId: dnsRecordId
                };
            } catch (error) {
                prettyLog('Deployment Error', {
                    error: error.message,
                    stack: error.stack
                });
                throw error;
            }
        })();

        // Clean up
        fs.unlinkSync(zipPath);
        
        // Store deployment info in database with project_name and dns_record_id
        const userId = req.session.user.id;
        await db.query(
            'INSERT INTO sites (user_id, subdomain, project_name, dns_record_id, preview_url, custom_domain_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [
                userId,
                subdomain,
                deploymentResult.projectName,
                deploymentResult.dnsRecordId,
                deploymentResult.previewUrl,
                deploymentResult.customDomainUrl
            ]
        );

        prettyLog('Deployment Complete', {
            previewUrl: deploymentResult.previewUrl,
            customDomainUrl: deploymentResult.customDomainUrl,
            subdomain: subdomain,
            projectName: deploymentResult.projectName,
            dnsRecordId: deploymentResult.dnsRecordId
        });

        // Send final success response
        res.write(`data: ${JSON.stringify({
            stage: 10,
            message: 'Deployment completed!',
            previewUrl: deploymentResult.previewUrl,
            customDomainUrl: deploymentResult.customDomainUrl,
            subdomain: subdomain,
            completed: true
        })}\n\n`);
        
        res.end();
    } catch (error) {
        prettyLog('Error', {
            message: error.message,
            stack: error.stack
        });
        console.error('Deployment error:', error);
        res.write(`data: ${JSON.stringify({ stage: -1, message: 'Deployment failed: ' + error.message })}\n\n`);
        res.end();
    }
});

app.post('/signup', async (req, res) => {
    const { firstName, lastName, email, password, confirmPassword } = req.body;
    
    try {
        // Validate password match
        if (password !== confirmPassword) {
            return res.redirect('/signup?error=' + encodeURIComponent('Passwords do not match'));
        }

        // Check if user already exists
        const existingUser = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.redirect('/signup?error=' + encodeURIComponent('Email already registered'));
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user
        const result = await db.query(
            'INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
            [firstName, lastName, email, hashedPassword]
        );

        // Set session
        req.session.user = {
            id: result.rows[0].id,
            email: result.rows[0].email,
            firstName: result.rows[0].first_name,
            lastName: result.rows[0].last_name
        };

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Signup error:', error);
        res.redirect('/signup?error=' + encodeURIComponent('An error occurred. Please try again.'));
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // Find user by email
        const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
        }

        // Compare passwords
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
        }

        // Set session
        req.session.user = {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name
        };

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.redirect('/login?error=' + encodeURIComponent('An error occurred. Please try again.'));
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Add delete site route
app.delete('/sites/:subdomain', async (req, res) => {
    const { subdomain } = req.params;
    const userId = req.session.user.id;

    try {
        // Check if site exists and belongs to user
        const site = await db.query(
            'SELECT * FROM sites WHERE subdomain = $1 AND user_id = $2',
            [subdomain, userId]
        );

        if (site.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Site not found or you do not have permission to delete it'
            });
        }

        const siteData = site.rows[0];
        const customDomain = `${subdomain}.${MAIN_DOMAIN}`;

        // Step 1: Delete custom domain from Pages project
        try {
            console.log(`Deleting custom domain ${customDomain} from Pages project ${siteData.project_name}`);
            const deleteDomainResponse = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${siteData.project_name}/domains/${customDomain}`,
                {
                    method: 'DELETE',
                    headers: {
                        'X-Auth-Email': CLOUDFLARE_EMAIL,
                        'X-Auth-Key': CLOUDFLARE_API_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const deleteDomainData = await deleteDomainResponse.json();
            if (!deleteDomainData.success) {
                console.error('Error deleting custom domain:', deleteDomainData.errors);
                // Continue with deletion even if domain deletion fails
            } else {
                console.log(`Successfully deleted custom domain ${customDomain}`);
            }
        } catch (error) {
            console.error('Error deleting custom domain:', error);
            // Continue with deletion even if domain deletion fails
        }

        // Step 2: Delete DNS record
        try {
            await deleteDNSRecord(siteData.dns_record_id);
        } catch (error) {
            console.error('Error deleting DNS record:', error);
            // Continue with deletion even if DNS record deletion fails
        }

        // Step 3: Delete Cloudflare Pages project
        try {
            await deleteCloudflarePages(siteData.project_name);
        } catch (error) {
            console.error('Error deleting Cloudflare Pages project:', error);
            // Continue with deletion even if Pages project deletion fails
        }

        // Step 4: Delete from database
        await db.query(
            'DELETE FROM sites WHERE subdomain = $1 AND user_id = $2',
            [subdomain, userId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error in site deletion:', error);
        res.status(500).json({
            success: false,
            error: 'An error occurred while deleting the site. Please try again.'
        });
    }
});

// Add the check-subdomain endpoint
app.get('/check-subdomain/:subdomain', async (req, res) => {
    try {
        const subdomain = req.params.subdomain.toLowerCase();
        
        // Validate subdomain format
        if (!/^[a-z0-9-]+$/.test(subdomain)) {
            return res.status(400).json({ 
                available: false, 
                error: 'Invalid subdomain format' 
            });
        }

        // Check if subdomain exists in database
        const result = await db.query(
            'SELECT id FROM sites WHERE subdomain = $1',
            [subdomain]
        );

        res.json({ available: result.rows.length === 0 });
    } catch (error) {
        console.error('Error checking subdomain:', error);
        res.status(500).json({ 
            available: false, 
            error: 'Error checking subdomain availability' 
        });
    }
});

// File Manager Routes
app.get('/filemanager/:subdomain', isAuthenticated, async (req, res) => {
    try {
        const { subdomain } = req.params;
        const userId = req.session.user.id;

        // Check if site exists and belongs to user
        const site = await db.query(
            'SELECT * FROM sites WHERE subdomain = $1 AND user_id = $2',
            [subdomain, userId]
        );

        if (site.rows.length === 0) {
            return res.status(404).send('Site not found');
        }

        // Ensure site directory exists
        const sitePath = path.join(__dirname, 'uploads', userId.toString(), subdomain);
        if (!fs.existsSync(sitePath)) {
            fs.mkdirSync(sitePath, { recursive: true });
        }

        res.render('filemanager', { 
            user: req.session.user,
            site: site.rows[0]
        });
    } catch (error) {
        console.error('Error loading file manager:', error);
        res.status(500).send('Error loading file manager');
    }
});

// File tree endpoint
app.get('/api/sites/:subdomain/files', isAuthenticated, async (req, res) => {
    try {
        const { subdomain } = req.params;
        const userId = req.session.user.id;

        // Verify site ownership
        const site = await db.query(
            'SELECT * FROM sites WHERE subdomain = $1 AND user_id = $2',
            [subdomain, userId]
        );

        if (site.rows.length === 0) {
            return res.status(404).json({ error: 'Site not found' });
        }

        const sitePath = path.join(__dirname, 'uploads', userId.toString(), subdomain);
        
        // Check if directory exists
        if (!fs.existsSync(sitePath)) {
            return res.json([]);
        }

        // Build file tree recursively
        function buildFileTree(dir) {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            const files = items.map(item => {
                const itemPath = path.join(dir, item.name);
                const relativePath = path.relative(sitePath, itemPath).replace(/\\/g, '/'); // Normalize path separators
                
                if (item.isDirectory()) {
                    return {
                        name: item.name,
                        type: 'directory',
                        path: relativePath,
                        children: buildFileTree(itemPath)
                    };
                } else {
                    return {
                        name: item.name,
                        type: 'file',
                        path: relativePath
                    };
                }
            });

            // Sort: directories first, then files, both alphabetically
            return files.sort((a, b) => {
                if (a.type === b.type) {
                    return a.name.localeCompare(b.name);
                }
                return a.type === 'directory' ? -1 : 1;
            });
        }

        const fileTree = buildFileTree(sitePath);
        res.json(fileTree);

    } catch (error) {
        console.error('Error building file tree:', error);
        res.status(500).json({ error: 'Failed to read directory' });
    }
});

// Get file content
app.get('/api/sites/:subdomain/files/:filePath(*)', isAuthenticated, async (req, res) => {
    try {
        const { subdomain, filePath } = req.params;
        const userId = req.session.user.id;

        // Verify site ownership
        const site = await db.query(
            'SELECT * FROM sites WHERE subdomain = $1 AND user_id = $2',
            [subdomain, userId]
        );

        if (site.rows.length === 0) {
            return res.status(404).json({ error: 'Site not found' });
        }

        const normalizedFilePath = filePath.replace(/\//g, path.sep);
        const fullPath = path.join(__dirname, 'uploads', userId.toString(), subdomain, normalizedFilePath);
        
        // Security check: ensure path is within site directory
        const sitePath = path.join(__dirname, 'uploads', userId.toString(), subdomain);
        if (!fullPath.startsWith(sitePath)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Check if file exists
        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stats = await fsPromises.stat(fullPath);
        if (!stats.isFile()) {
            return res.status(400).json({ error: 'Not a file' });
        }

        const content = await fsPromises.readFile(fullPath, 'utf8');
        res.json({ content });
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// Save file content
app.post('/api/sites/:subdomain/files/:filePath(*)', isAuthenticated, async (req, res) => {
    try {
        const { subdomain, filePath } = req.params;
        const { content } = req.body;
        const userId = req.session.user.id;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Verify site ownership
        const site = await db.query(
            'SELECT * FROM sites WHERE subdomain = $1 AND user_id = $2',
            [subdomain, userId]
        );

        if (site.rows.length === 0) {
            return res.status(404).json({ error: 'Site not found' });
        }

        const normalizedFilePath = filePath.replace(/\//g, path.sep);
        const fullPath = path.join(__dirname, 'uploads', userId.toString(), subdomain, normalizedFilePath);
        
        // Security check: ensure path is within site directory
        const sitePath = path.join(__dirname, 'uploads', userId.toString(), subdomain);
        if (!fullPath.startsWith(sitePath)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Ensure directory exists
        await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });

        // Write file content
        await fsPromises.writeFile(fullPath, content, 'utf8');
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// Deploy updated site
app.post('/api/sites/:subdomain/deploy', isAuthenticated, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT * FROM sites WHERE subdomain = $1 AND user_id = $2',
            [req.params.subdomain, req.session.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Site not found' });
        }

        const site = result.rows[0];
        const deployer = new CloudflareDeployer({
            ...site,
            userId: req.session.user.id
        });
        
        const deployResult = await deployer.deployToCloudflare();

        if (deployResult.success) {
            // Validate the deployment
            const isValid = await CloudflareDeployer.validateDeployment(deployResult.url);
            
            if (isValid) {
                res.json({ 
                    message: 'Site deployed successfully',
                    url: deployResult.url
                });
            } else {
                res.status(500).json({ 
                    error: 'Deployment validation failed',
                    url: deployResult.url
                });
            }
        } else {
            res.status(500).json({ 
                error: deployResult.message,
                details: deployResult.error
            });
        }
    } catch (error) {
        console.error('Error during deployment:', error);
        res.status(500).json({ error: 'Deployment failed', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at https://localhost:${port}`);
}); 
