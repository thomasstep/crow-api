import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * For copying shared code to all paths
 */
import * as fse from 'fs-extra';

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

export interface LambdasByPath {
  [path: string]: lambda.Function,
}

export interface CrowLambdaConfiguration extends lambda.FunctionProps {
  readonly useAuthorizerLambda: boolean,
}

export interface CrowLambdaConfigurations {
  // lambdaByPath should be lambda.FunctionProps
  // without anything required
  // but jsii does not allow for Omit type
  [lambdaByPath: string]: CrowLambdaConfiguration | any,
}

export interface ICrowApiProps {
  sourceDirectory?: string,
  sharedDirectory?: string,
  useAuthorizerLambda?: boolean,
  authorizerDirectory?: string,
  // authorizerLambdaConfiguration should be lambda.FunctionProps
  // without anything required
  // but jsii does not allow for Omit type
  authorizerLambdaConfiguration?: lambda.FunctionProps | any,
  // authorizerConfiguration should be apigateway.TokenAuthorizerProps
  // without anything required
  // but jsii does not allow for Omit type
  tokenAuthorizerConfiguration?: apigateway.TokenAuthorizerProps | any,
  createApiKey?: boolean,
  logRetention?: logs.RetentionDays,
  // apiGatwayConfiguration should be apigateway.LambdaRestApiProps
  // without anything required
  // but jsii does not allow for Omit type
  apiGatewayConfiguration?: apigateway.LambdaRestApiProps | any,
  apiGatewayName?: string,
  lambdaConfigurations?: CrowLambdaConfigurations,
}

interface FSGraphNode {
  resource: apigateway.IResource,
  path: string,
  paths: string[],
  verbs: string[],
}

interface FSGraph {
  [path: string]: FSGraphNode,
}

export class CrowApi extends Construct {
  public authorizerLambda!: lambda.Function;
  public gateway!: apigateway.RestApi;
  public lambdaLayer!: lambda.LayerVersion | undefined;
  public lambdaFunctions!: LambdasByPath;

  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope: Construct, id: string, props: ICrowApiProps) {
    super(scope, id);

    // Pulling out props
    const {
      sourceDirectory = 'src',
      sharedDirectory = 'shared',
      useAuthorizerLambda = false,
      authorizerDirectory = 'authorizer',
      authorizerLambdaConfiguration = {},
      tokenAuthorizerConfiguration = {},
      createApiKey = false,
      logRetention = logs.RetentionDays.ONE_WEEK,
      apiGatewayConfiguration = {},
      apiGatewayName = 'crow-api',
      lambdaConfigurations = {},
    } = props;

    // Initializing constants
    const LAMBDA_RUNTIME = lambda.Runtime.NODEJS_14_X;
    const SPECIAL_DIRECTORIES = [
      sharedDirectory,
      authorizerDirectory,
    ];

    // Helpers functions for constructor

    // Prepares default Lambda props and overrides them with user input
    function bundleLambdaProps(
      codePath: string,
      userConfiguration: CrowLambdaConfiguration | any,
      sharedLayer: lambda.LayerVersion | undefined,
    ) {
      let layers;
      if (sharedLayer) {
        const {
          layers: userLayers = [],
        } = userConfiguration;
        layers = [sharedLayer, ...userLayers];
      }

      const defaultProps = {
        runtime: LAMBDA_RUNTIME,
        code: lambda.Code.fromAsset(codePath),
        handler: 'index.handler',
        logRetention,
      };

      const lambdaProps = {
        ...defaultProps,
        ...userConfiguration, // Let user configuration override anything except layers
        layers,
      }

      return lambdaProps;
    }

    // Returns child directories given the path of a parent
    function getDirectoryChildren(parentDirectory: string) {
      try {
        const directories = fse.readdirSync(parentDirectory, { withFileTypes: true })
          .filter((dirent: any) => dirent.isDirectory())
          .map((dirent: any) => dirent.name);
        return directories;
      } catch {
        /**
         * The only time I have run into this was when the src/ directory
         * was empty.
         * If it is empty, let CDK tree validation tell user that the
         * REST API does not have any methods.
         */
      }
      return [];
    }

    // A default Lambda function is needed for the API Gateway
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
    const gateway = new apigateway.LambdaRestApi(this, apiGatewayName, {
      handler: defaultLambda,
      proxy: false,
      deploy: true,
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        accessLogDestination: new apigateway.LogGroupLogDestination(gatewayLogGroup),
      },
      apiKeySourceType: createApiKey ? apigateway.ApiKeySourceType.HEADER : undefined,
      ...apiGatewayConfiguration,
    });

    // Create API key if desired
    if (createApiKey) {
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

    // Create Lambda layer out of shared directory if it exists
    const sourceSharedDirectory = `${sourceDirectory}/${sharedDirectory}`;
    let sharedLayer: lambda.LayerVersion | undefined;
    if (fse.existsSync(sourceSharedDirectory)) {
      sharedLayer = new lambda.LayerVersion(this, 'shared-layer', {
        code: lambda.Code.fromAsset(sourceSharedDirectory),
        compatibleRuntimes: [LAMBDA_RUNTIME],
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      this.lambdaLayer = sharedLayer;
    }

    // Create Lambda authorizer to be used in subsequent Methods
    let tokenAuthorizer: apigateway.IAuthorizer;
    if (useAuthorizerLambda) {
      const fullAuthorizerDirectory = `${sourceDirectory}/${authorizerDirectory}`;

      const authorizerLambdaProps = bundleLambdaProps(fullAuthorizerDirectory, authorizerLambdaConfiguration, sharedLayer);

      const authorizerLambda = new lambda.Function(this, 'authorizer-lambda', authorizerLambdaProps);
      this.authorizerLambda = authorizerLambda;

      const bundledTokenAuthConfig = {
        handler: authorizerLambda,
        resultsCacheTtl: cdk.Duration.seconds(3600),
        ...tokenAuthorizerConfiguration,
      };
      tokenAuthorizer = new apigateway.TokenAuthorizer(
        this,
        'token-authorizer',
        bundledTokenAuthConfig
      );
    }

    // Time to start walking the directories
    const root = sourceDirectory;
    const verbs = ['get', 'post', 'put', 'delete'];
    const graph: FSGraph = {};
    const lambdasByPath: LambdasByPath = {};

    // Initialize with root
    graph['/'] = {
      resource: gateway.root,
      path: root,
      paths: [],
      verbs: [],
    };
    // First element in tuple is directory path, second is API path
    const nodes: [string, string][] = [[root, '/']];

    // BFS that creates API Gateway structure using addMethod
    while (nodes.length) {
      // The `|| ['type', 'script']` piece is needed or TS throws a fit
      const [directoryPath, apiPath] = nodes.shift() || ['type', 'script'];
      const children: any[] = getDirectoryChildren(directoryPath);

      // For debugging purposes
      // console.log(`${apiPath}'s children are: ${children}`);

      // Don't have to worry about previously visited nodes
      // since this is a file structure
      // ...unless there are symlinks? Haven't run into that
      children.forEach((child) => {

        const newDirectoryPath = `${directoryPath}/${child}`;
        // If we're on the root path, don't separate with a slash (/)
        //   because it ends up looking like //child-path
        const newApiPath = apiPath === '/' ? `/${child}` : `${apiPath}/${child}`;

        if (verbs.includes(child)) {
          // If directory is a verb, we don't traverse it anymore
          //   and need to create an API Gateway method and Lambda
          const userConfiguration = lambdaConfigurations[newApiPath] || {};
          const lambdaProps = bundleLambdaProps(newDirectoryPath, userConfiguration, sharedLayer);
          const { useAuthorizerLambda: authorizerLambdaConfigured } = lambdaProps;

          const newLambda = new lambda.Function(this, newDirectoryPath, lambdaProps);

          let methodConfiguration: apigateway.MethodOptions | undefined;
          if (authorizerLambdaConfigured && useAuthorizerLambda) {
            methodConfiguration = {
              authorizationType: apigateway.AuthorizationType.CUSTOM,
              authorizer: tokenAuthorizer,
            }
          }

          graph[apiPath].resource.addMethod(
            child.toUpperCase(),
            new apigateway.LambdaIntegration(newLambda),
            methodConfiguration,
          );
          graph[apiPath].verbs.push(child);
          lambdasByPath[newApiPath] = newLambda;

        } else if (SPECIAL_DIRECTORIES.includes(child)) {
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

          // Initialize graph node to include child
          graph[newApiPath] = {
            resource: newResource,
            path: newDirectoryPath,
            paths: [],
            verbs: [],
          };

        }
      });
    }

    // For debugging purposes
    // console.log(graph);

    // Expose API Gateway
    this.gateway = gateway;
    this.lambdaFunctions = lambdasByPath;
  }
}
