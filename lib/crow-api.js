const cdk = require('@aws-cdk/core');
const { Asset } = require('@aws-cdk/aws-s3-assets');
const lambda = require('@aws-cdk/aws-lambda');
// const nodeLambda = require('@aws-cdk/aws-lambda-nodejs');
const apigateway = require('@aws-cdk/aws-apigateway');
const logs = require('@aws-cdk/aws-logs');

/**
 * For copying shared code to all paths
 */
const path = require('path');
const fse = require('fs-extra');

const DEFAULT_LAMBDA_CODE = `
exports.handler = async function (event, context, callback) {
  try {
    const data = {
      statusCode: 201,
    };
    return data;
  } catch (uncaughtError) {
    console.error(uncaughtError);
    throw uncaughtError;
  }
}
`;

class CrowApi extends cdk.Construct {
  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const {
      sourceDirectory = 'src',
      sharedDirectory = 'shared',
      useAuthorizerLambda = false,
      authorizerDirectory = 'authorizer',
      authorizerConfiguration = {},
      createApiKey = false,
      logRetention = logs.RetentionDays.ONE_WEEK,
      databaseTables: databaseTablesUsed = {},
      lambdaConfigurations = {},
    } = props;

    const specialDirectories = [
      sharedDirectory,
      authorizerDirectory,
    ];

    const defaultLambda = new lambda.Function(this, 'default-crow-lambda', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: new lambda.InlineCode(DEFAULT_LAMBDA_CODE),
      handler: 'index.handler',
      logRetention,
    });

    // API Gateway log group
    const gatewayLogGroup = new logs.LogGroup(this, 'api-access-logs', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // The API Gateway itself
    const gateway = new apigateway.LambdaRestApi(this, 'crow-api', {
      handler: defaultLambda,
      proxy: false,
      deploy: true,
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        accessLogDestination: new apigateway.LogGroupLogDestination(gatewayLogGroup),
      },
      apiKeySourceType: createApiKey ? apigateway.ApiKeySourceType.HEADER : undefined,
    });

    if (createApiKey) {
      // API Key
      const apiKey = gateway.addApiKey('api-key');
      const usagePlan = new apigateway.UsagePlan(this, 'usage-plan', {
        throttle: {
          burstLimit: 5000,
          rateLimit: 10000,
        },
        apiStages: [
          {
            api: gateway,
            stage: gateway.deploymentStage,
          },
        ],
      });
      usagePlan.addApiKey(apiKey);
    }

    let tokenAuthorizer;
    if (useAuthorizerLambda) {
      const fullAuthorizerDirectory = `${sourceDirectory}/${authorizerDirectory}`;

      copySharedDirectory(fullAuthorizerDirectory);

      const authorizerLambda = new lambda.Function(this, 'authorizer-lambda', {
        runtime: lambda.Runtime.NODEJS_14_X,
        code: lambda.Code.fromAsset(fullAuthorizerDirectory),
        handler: 'index.handler',
        logRetention,
      });

      const tokenAuthorizerConfiguration = {
        handler: authorizerLambda,
        resultsCacheTtl: cdk.Duration.seconds(3600),
        ...authorizerConfiguration,
      };
      tokenAuthorizer = new apigateway.TokenAuthorizer(
        this,
        'token-authorizer',
        tokenAuthorizerConfiguration
      );
    }

    // Returns child directories given the path of a parent
    function getDirectoryChildren(parentDirectory) {
      const directories = fse.readdirSync(parentDirectory, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
      return directories;
    }

    // Copies shared directory to a given target directory
    function copySharedDirectory(targetPath) {
      const sourceSharedDirectory = `${sourceDirectory}/${sharedDirectory}`;
      const targetSharedDirectory = `${targetPath}/${sharedDirectory}`;
      // NOTE this is file I/O so it takes a while
      fse.emptyDirSync(
        targetSharedDirectory,
      );
      // Copy shared code to target path
      try {
        fse.copySync(
          sourceSharedDirectory,
          targetSharedDirectory,
        );
      } catch (err) {
        // console.error(err);
        console.error(`There was an error copying the shared directory to ${targetSharedDirectory}`);
        // Let this pass and not disrupt the entire application
      }
    }

    // Given a path, look for crow.json and return configuration
    function getConfiguration(path) {
      const configurationFile = `${path}/crow.json`;
      try {
        if (fse.existsSync(configurationFile)) {
          const configuration = fse.readJsonSync(configurationFile);
          return configuration;
        }
      } catch (err) {
        console.error(err);
        // Don't want to crash synth if config file isn't present
      }

      return {};
    }

    function bundleLambdaProps(userConfiguration, codePath, apiPath) {
      const {
        lambdaConfiguration,
        databaseTables,
      } = userConfiguration;

      const propConfiguration = lambdaConfigurations[apiPath] || {};

      const lambdaProps = {
        runtime: lambda.Runtime.NODEJS_14_X,
        code: lambda.Code.fromAsset(codePath), // normal Lambda
        handler: 'index.handler', // normal Lambda
        // entry: `${codePath}/index.js`, // Nodejs Lambda
        logRetention,
        environment: {}, // Initialize this to allow spreading later
        ...lambdaConfiguration, // Let user override any defaults
        ...propConfiguration, // Let prop configuration override anything
      };

      if (databaseTables) {
        const tableEnvironmentVariables = {};
        Object.entries(databaseTables).forEach(([table, environmentVariableName]) => {
          tableEnvironmentVariables[environmentVariableName] = databaseTablesUsed[table]?.tableName;
        });

        const environmentWithTables = {
          // Let any manual environment variables take precedence over
          //   automated ones
          ...tableEnvironmentVariables,
          ...lambdaProps.environment,
        };
        lambdaProps.environment = environmentWithTables;
      }

      return lambdaProps;
    }

    function grantTablePermissions(newLambda, userConfiguration) {
      const {
        databaseTables,
      } = userConfiguration;

      if (!databaseTables) {
        return
      }
      Object.keys(databaseTables).forEach((table) => {
        databaseTablesUsed[table]?.grantFullAccess(newLambda);
      });
    }

    const root = sourceDirectory;
    const verbs = ['get', 'post', 'put', 'delete'];
    const graph = {};
    const lambdasByPath = {};

    // Initialize with root
    graph['/'] = {
      resource: gateway.root,
      path: root,
      paths: [],
      verbs: [],
    };
    // First is directory path, second is API path
    const nodes = [[root, '/']];

    // BFS that creates API Gateway structure and copies shared code
    while (nodes.length) {
      const [directoryPath, apiPath] = nodes.shift();
      const children = getDirectoryChildren(directoryPath);
      // console.log(`${apiPath}'s children are: ${children}`);

      // Don't have to worry about previously visited nodes since this is a file structure...unless there are symlinks?
      children.forEach((child) => {

        const newDirectoryPath = `${directoryPath}/${child}`;
        // If we're on the root path, don't separate with a slash (/)
        //   because it ends up looking like //child-path
        const newApiPath = apiPath === '/' ? `/${child}` : `${apiPath}/${child}`;

        if (verbs.includes(child)) {
          // If directory is a verb, we don't traverse it anymore
          //   and need to create an API Gateway method and Lambda

          const configuration = getConfiguration(newDirectoryPath);
          const lambdaProps = bundleLambdaProps(configuration, newDirectoryPath, newApiPath);
          const { useAuthorizerLambda: authorizerLambdaConfigured } = configuration;

          copySharedDirectory(newDirectoryPath);

          const newLambda = new lambda.Function(this, newDirectoryPath, lambdaProps);

          grantTablePermissions(newLambda, configuration);

          const methodConfiguration = {};
          if (authorizerLambdaConfigured && useAuthorizerLambda) {
            methodConfiguration.authorizationType = apigateway.AuthorizationType.CUSTOM;
            methodConfiguration.authorizer = tokenAuthorizer;
          }

          graph[apiPath].resource.addMethod(
            child.toUpperCase(),
            new apigateway.LambdaIntegration(newLambda),
            methodConfiguration,
          );
          graph[apiPath].verbs.push(child);
          lambdasByPath[newApiPath] = newLambda;

        } else if (specialDirectories.includes(child)) {
          // The special directories should not result in an API path
          // This means the API also cannot have a resource with the
          //   same name
        } else {
          // If directory is not a verb, create new API Gateway resource
          //   for use by verb directory later

          const newResource = graph[apiPath].resource
            .resourceForPath(child);

          nodes.push([newDirectoryPath, newApiPath]);

          // Add child to parent's paths
          graph[apiPath].paths.push(child);

          // Initialize graph to include child
          graph[newApiPath] = {
            resource: newResource,
            path: newDirectoryPath,
            paths: [],
            verbs: [],
          };

        }
      });
    }

    // console.log(graph);

    // Expose API Gateway
    this.gateway = gateway;
    this.lambdaFunctions = lambdasByPath;
  }
}

module.exports = { CrowApi }
