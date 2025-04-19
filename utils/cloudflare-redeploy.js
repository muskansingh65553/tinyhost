const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class CloudflareDeployer {
    constructor(siteConfig) {
        if (!siteConfig.project_name) {
            throw new Error('project_name is required in siteConfig');
        }
        if (!process.env.MAIN_DOMAIN) {
            throw new Error('MAIN_DOMAIN environment variable is required');
        }
        this.siteConfig = siteConfig;
        this.deploymentPath = path.join(process.cwd(), 'uploads', siteConfig.userId.toString(), siteConfig.subdomain);
        this.mainDomain = process.env.MAIN_DOMAIN;
    }

    async deployToCloudflare() {
        try {
            console.log(`🚀 Starting deployment for ${this.siteConfig.subdomain}...`);
            console.log(`📂 Project name: ${this.siteConfig.project_name}`);
            console.log(`📁 Deploying from directory: ${this.deploymentPath}`);
            console.log(`🌐 Domain: ${this.siteConfig.subdomain}.${this.mainDomain}`);
            
            // Deploy the directory directly using wrangler
            const command = `wrangler pages deploy "${this.deploymentPath}" --project-name="${this.siteConfig.project_name}"`;
            console.log('⚙️ Executing command:', command);

            const { stdout, stderr } = await execPromise(command);
            
            // Log deployment output
            if (stdout) console.log('📝 Deployment output:', stdout);
            if (stderr) console.warn('⚠️ Deployment warnings:', stderr);

            // Check for successful deployment indicators in output
            if (stdout.includes('Success!') || stdout.includes('Deployment complete')) {
                console.log('✨ Deployment completed successfully!');
                return {
                    success: true,
                    message: 'Deployment completed successfully',
                    url: `https://${this.siteConfig.subdomain}.${this.mainDomain}`
                };
            } else {
                throw new Error('Deployment completed but success message not found in output');
            }

        } catch (error) {
            console.error('❌ Deployment failed:', error);
            return {
                success: false,
                message: `Deployment failed: ${error.message}`,
                error: error
            };
        }
    }

    static async validateDeployment(url, maxRetries = 5, retryDelay = 2000) {
        console.log(`🔍 Validating deployment at ${url}`);
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    console.log('✅ Deployment validation successful');
                    return true;
                }
                console.log(`⏳ Attempt ${i + 1}/${maxRetries}: Site not ready yet (Status: ${response.status})`);
            } catch (error) {
                console.warn(`⚠️ Validation attempt ${i + 1} failed:`, error.message);
            }

            if (i < maxRetries - 1) {
                console.log(`⏳ Waiting ${retryDelay/1000} seconds before next check...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        console.error('❌ Deployment validation failed after all retries');
        return false;
    }
}

module.exports = CloudflareDeployer; 