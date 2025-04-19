const fetch = require('node-fetch');

// Cloudflare configuration
const MAIN_DOMAIN = 'visual-html-editor.online';
const CLOUDFLARE_ZONE_ID = 'd15ed27d46aaa4797882a7c5f948188c';
const CLOUDFLARE_EMAIL = 'Kashyapkumbhani18@gmail.com';
const CLOUDFLARE_API_KEY = '89a8296454cd257be609d326c7d673c5e735f';
const CLOUDFLARE_ACCOUNT_ID = '217f6f87437d3b5067efae8c720b84bc';

// Create CNAME record using Cloudflare API
async function createCNAMERecord(subdomain, pagesUrl) {
    try {
        console.log(`Creating CNAME record for ${subdomain}.${MAIN_DOMAIN} -> ${pagesUrl}`);
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Email': CLOUDFLARE_EMAIL,
                    'X-Auth-Key': CLOUDFLARE_API_KEY
                },
                body: JSON.stringify({
                    type: 'CNAME',
                    name: `${subdomain}.${MAIN_DOMAIN}`,
                    content: pagesUrl,
                    proxied: false,
                    ttl: 1
                })
            }
        );

        const data = await response.json();
        console.log('CNAME creation response:', data);
        
        if (!data.success) {
            console.error('Failed to create CNAME record:', data.errors);
            throw new Error(`Failed to create CNAME record: ${data.errors?.[0]?.message || 'Unknown error'}`);
        }

        // Return the dns_record_id
        return data.result.id;
    } catch (error) {
        console.error('Error creating CNAME record:', error);
        throw error;
    }
}

// Attach custom domain to Pages project
async function attachCustomDomain(projectName, domain) {
    try {
        console.log(`Attaching custom domain ${domain} to project ${projectName}`);
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/domains`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Email': CLOUDFLARE_EMAIL,
                    'X-Auth-Key': CLOUDFLARE_API_KEY
                },
                body: JSON.stringify({
                    name: domain
                })
            }
        );

        const data = await response.json();
        console.log('Custom domain attachment response:', data);
        
        if (!data.success) {
            console.error('Failed to attach custom domain:', data.errors);
            throw new Error(`Failed to attach custom domain: ${data.errors?.[0]?.message || 'Unknown error'}`);
        }
        return data;
    } catch (error) {
        console.error('Error attaching custom domain:', error);
        throw error;
    }
}

// Create wrangler.toml configuration
function createWranglerConfig(subdomain) {
    const config = `
name = "${subdomain}"
compatibility_date = "2024-01-01"

routes = [
  { pattern = "${subdomain}.${MAIN_DOMAIN}", custom_domain = true }
]
`;
    return config;
}

// Delete DNS record
async function deleteDNSRecord(dnsRecordId) {
    try {
        console.log(`Deleting DNS record: ${dnsRecordId}`);
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${dnsRecordId}`,
            {
                method: 'DELETE',
                headers: {
                    'X-Auth-Email': CLOUDFLARE_EMAIL,
                    'X-Auth-Key': CLOUDFLARE_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = await response.json();
        if (!data.success) {
            console.error('Failed to delete DNS record:', data.errors);
            throw new Error(`Failed to delete DNS record: ${data.errors?.[0]?.message || 'Unknown error'}`);
        }
        return data;
    } catch (error) {
        console.error('Error deleting DNS record:', error);
        throw error;
    }
}

// Delete Cloudflare Pages project
async function deleteCloudflarePages(projectName) {
    try {
        console.log(`Deleting Cloudflare Pages project: ${projectName}`);
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}`,
            {
                method: 'DELETE',
                headers: {
                    'X-Auth-Email': CLOUDFLARE_EMAIL,
                    'X-Auth-Key': CLOUDFLARE_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        const data = await response.json();
        if (!data.success) {
            console.error('Failed to delete Pages project:', data.errors);
            throw new Error(`Failed to delete Pages project: ${data.errors?.[0]?.message || 'Unknown error'}`);
        }
        return data;
    } catch (error) {
        console.error('Error deleting Pages project:', error);
        throw error;
    }
}

module.exports = {
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
}; 