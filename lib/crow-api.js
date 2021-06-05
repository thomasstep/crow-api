const cdk = require('@aws-cdk/core');
const { Asset } = require('@aws-cdk/aws-s3-assets');
const lambda = require('@aws-cdk/aws-lambda');
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
      createApiKey = false,
      logRetention = logs.RetentionDays.ONE_WEEK,
    } = props;

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
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
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

    // Returns child directories given the path of a parent
    function getDirectoryChildren(parentDirectory) {
      const directories = fse.readdirSync(parentDirectory, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
      return directories;
    }

    // Copies shared directory to a given target directory
    function copySharedDirectory(targetPath) {
      // NOTE this is file I/O so it takes a while
      fse.emptyDirSync(
        path.resolve(__dirname, `../${targetPath}/${sharedDirectory}`),
      );
      // Copy shared code to target path
      try {
        fse.copySync(
          `${sourceDirectory}/${sharedDirectory}`,
          `${targetPath}/${sharedDirectory}`,
        );
      } catch (err) {
        // console.error(err);
        // Let this pass and not disrupt the entire application
      }
    }

    // BFS that creates API Gateway structure and copies shared code
    const root = sourceDirectory;
    const verbs = ['get', 'post', 'put', 'delete'];
    const graph = {};

    // Initialize with root
    graph[root] = {
      resource: gateway.root,
      apiPath: '/',
      paths: [],
      verbs: [],
    };
    // First is path, second is directory name used in path graph
    const nodes = [[root, root]];

    console.log(__dirname)
    while (nodes.length) {
      const [directoryPath, node] = nodes.shift();
      const children = getDirectoryChildren(directoryPath);
      // console.log(`${node}'s children are: ${children}`);

      // Don't have to worry about previously visited nodes since this is a file structure...unless there are symlinks?
      children.forEach((child) => {

        const newPath = `${directoryPath}/${child}`;

        if (verbs.includes(child)) {

          // If directory is a verb, we don't traverse it anymore
          //   and need to create an API Gateway method and Lambda
          const newLambda = new lambda.Function(this, newPath, {
            runtime: lambda.Runtime.NODEJS_14_X,
            code: lambda.Code.fromAsset(newPath),
            handler: 'index.handler',
            logRetention,
            // TODO environment: smth,
          });

          graph[node].resource.addMethod(child.toUpperCase(), new apigateway.LambdaIntegration(newLambda));

          graph[node].verbs.push(child);

          copySharedDirectory(`${directoryPath}/${child}`);

        } else if (child === sharedDirectory) {
          // the shared directory should not result in an API path
        } else {

          // Create new API Gateway resource for use by verb directory later
          const newResource = graph[node].resource
            .resourceForPath(child);

          nodes.push([newPath, child]);

          // Add child to parent's paths
          graph[node].paths.push(child);

          // Initialize graph to include child
          graph[child] = {
            resource: newResource,
            path: newPath,
            paths: [],
            verbs: [],
          };

        }
      });
    }

    // console.log(graph);

    // Expose API Gateway
    this.gateway = gateway;
  }
}

module.exports = { CrowApi }
