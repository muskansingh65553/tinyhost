Create your project
Log in to Wrangler with the wrangler login command. Then run the pages project create command:

Terminal window
npx wrangler pages project create

You will then be prompted to specify the project name. Your project will be served at <PROJECT_NAME>.pages.dev (or your project name plus a few random characters if your project name is already taken). You will also be prompted to specify your production branch.

Subsequent deployments will reuse both of these values (saved in your node_modules/.cache/wrangler folder).

Deploy your assets
From here, you have created an empty project and can now deploy your assets for your first deployment and for all subsequent deployments in your production environment. To do this, run the wrangler pages deploy command:

Terminal window
npx wrangler pages deploy <BUILD_OUTPUT_DIRECTORY>

Find the appropriate build output directory for your project in Build directory under Framework presets.

Your production deployment will be available at <PROJECT_NAME>.pages.dev.

Note

Before using the wrangler pages deploy command, you will need to make sure you are inside the project. If not, you can also pass in the project path.

To deploy assets to a preview environment, run:

Terminal window
npx wrangler pages deploy <OUTPUT_DIRECTORY> --branch=<BRANCH_NAME>

For every branch you create, a branch alias will be available to you at <BRANCH_NAME>.<PROJECT_NAME>.pages.dev.

Note

If you are in a Git workspace, Wrangler will automatically pull the branch information for you. Otherwise, you will need to specify your branch in this command.

If you would like to streamline the project creation and asset deployment steps, you can also use the deploy command to both create and deploy assets at the same time. If you execute this command first, you will still be prompted to specify your project name and production branch. These values will still be cached for subsequent deployments as stated above. If the cache already exists and you would like to create a new project, you will need to run the create command.

Other useful commands
If you would like to use Wrangler to obtain a list of all available projects for Direct Upload, use pages project list:

Terminal window
npx wrangler pages project list

If you would like to use Wrangler to obtain a list of all unique preview URLs for a particular project, use pages deployment list:

Terminal window
npx wrangler pages deployment list

For step-by-step directions on how to use Wrangler and continuous integration tools like GitHub Actions, Circle CI, and Travis CI together for continuous deployment, refer to Use Direct Upload with continuous integration.