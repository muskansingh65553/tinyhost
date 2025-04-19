# Cloudflare Configuration Knowledge Base

## Cloudflare API Key
The project uses a Cloudflare Global API Key for authentication:
- API Key: `89a8296454cd257be609d326c7d673c5e735f`
- Location: `cloudflare-global-key.txt`

**Security Note**: This API key should be kept secure and not exposed publicly. Consider moving it to environment variables.

## Wrangler Deployment Information

### Project Structure
The project is configured to be deployed using Cloudflare Pages through Wrangler CLI tool.

### Deployment Commands

1. **Production Deployment**:
   - The production deployment will be available at `<PROJECT_NAME>.pages.dev`
   - Must be inside the project directory when deploying
   - Command: `npx wrangler pages deploy <OUTPUT_DIRECTORY>`

2. **Preview Deployment**:
   - For testing changes before production
   - Command: `npx wrangler pages deploy <OUTPUT_DIRECTORY> --branch=<BRANCH_NAME>`
   - Preview URL format: `<BRANCH_NAME>.<PROJECT_NAME>.pages.dev`
   - Git branches are automatically detected if in a Git workspace

### Useful Commands

- List all preview URLs:
  ```bash
  npx wrangler pages deployment list
  ```

### Additional Notes

- The project supports continuous integration tools:
  - GitHub Actions
  - Circle CI
  - Travis CI
- Build output directory should be specified according to the framework presets
- Branch information is auto-detected in Git workspaces, otherwise needs manual specification

### Best Practices

1. Always ensure you're in the correct project directory before deployment
2. Use preview deployments for testing changes
3. Implement continuous deployment using CI/CD tools for automated workflows
4. Keep track of deployment URLs for different branches
5. Regularly review and rotate API keys for security