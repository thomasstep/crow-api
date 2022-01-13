import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * For copying shared code to all paths
 */
import * as fse from 'fs-extra';

export interface LambdasByPath {
  [path: string]: lambda.Function,
}

export interface CrowLambdaConfigurations {
  [lambdaByPath: string]: lambda.FunctionProps,
}

// Same as ModelOptions but modelName is required (used as ID)
export interface CrowModelOptions {
  readonly schema: apigateway.JsonSchema,
  readonly modelName: string,
  readonly contentType?: string,
  readonly description?: string,
}

// Same as RequestValidatorOptions but requestValidatorName is required (used as ID)
export interface CrowRequestValidatorOptions {
  readonly requestValidatorName: string,
  readonly validateRequestBody?: boolean,
  readonly validateRequestParameters?: boolean,
}

export interface CrowMethodResponse {
  readonly statusCode: string,
  // Takes a string which is matched with the modelName
  readonly responseModels?: { [contentType: string]: string },
  readonly responseParameters?: { [param: string]: boolean }
}

export interface CrowMethodConfiguration {
  // Redefining MethodOptions since Omit is not supported
  readonly apiKeyRequired?: boolean,
  readonly authorizationScopes?: string[],
  readonly authorizationType?: apigateway.AuthorizationType,
  readonly authorizer?: apigateway.IAuthorizer,
  readonly methodResponses?: CrowMethodResponse[],
  readonly operationName?: string,
  // Takes a string which is matched with the modelName
  readonly requestModels?: { [contentType: string]: string },
  readonly requestParameters?: { [param: string]: boolean },
  // Takes a string which is matched with the requestValidatorName
  readonly requestValidator?: string,
  readonly requestValidatorOptions?: apigateway.RequestValidatorOptions,
  readonly useAuthorizerLambda?: boolean,
}

export interface CrowMethodConfigurations {
  // methodByPath should be lambda.FunctionProps
  // without anything required
  // but jsii does not allow for Omit type
  [methodByPath: string]: CrowMethodConfiguration,
}

export interface CrowApiProps {
  readonly sourceDirectory?: string,
  readonly sharedDirectory?: string,
  readonly useAuthorizerLambda?: boolean,
  readonly authorizerDirectory?: string,
  // authorizerLambdaConfiguration should be lambda.FunctionProps
  // without anything required
  // but jsii does not allow for Omit type
  readonly authorizerLambdaConfiguration?: lambda.FunctionProps | any,
  // authorizerConfiguration should be apigateway.TokenAuthorizerProps
  // without anything required
  // but jsii does not allow for Omit type
  readonly tokenAuthorizerConfiguration?: apigateway.TokenAuthorizerProps | any,
  readonly createApiKey?: boolean,
  readonly logRetention?: logs.RetentionDays,
  // apiGatwayConfiguration should be apigateway.LambdaRestApiProps
  // without anything required
  // but jsii does not allow for Omit type
  readonly apiGatewayConfiguration?: apigateway.RestApiProps | any,
  readonly apiGatewayName?: string,
  readonly lambdaConfigurations?: CrowLambdaConfigurations,
  readonly models?: CrowModelOptions[],
  readonly requestValidators?: CrowRequestValidatorOptions[],
  readonly methodConfigurations?: CrowMethodConfigurations,
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
  public models!: { [modelName: string]: apigateway.IModel };
  public requestValidators!: { [requestValidatorsName: string]: apigateway.IRequestValidator };

  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope: Construct, id: string, props: CrowApiProps) {
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
      models = [],
      requestValidators = [],
      methodConfigurations = {},
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
      userConfiguration: lambda.FunctionProps,
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

    // API Gateway log group
    const gatewayLogGroup = new logs.LogGroup(this, 'api-access-logs', {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // The API Gateway itself
    const gateway = new apigateway.RestApi(this, apiGatewayName, {
      deploy: true,
      deployOptions: {
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        accessLogDestination: new apigateway.LogGroupLogDestination(gatewayLogGroup),
      },
      apiKeySourceType: createApiKey ? apigateway.ApiKeySourceType.HEADER : undefined,
      ...apiGatewayConfiguration,
    });

    const createdModels: { [modelName: string]: apigateway.IModel } = {};
    models.forEach((model: CrowModelOptions) => {
      // modelName is used as ID and can now be used for referencing model in method options
      createdModels[model.modelName] = gateway.addModel(model.modelName, model);
    });
    const createdRequestValidators: { [requestValidatorsName: string]: apigateway.IRequestValidator } = {};
    requestValidators.forEach((requestValidator: CrowRequestValidatorOptions) => {
      // requestValidatorName is used as ID and can now be used for referencing model in method options
      createdRequestValidators[requestValidator.requestValidatorName] = gateway.addRequestValidator(requestValidator.requestValidatorName, requestValidator);
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
          const userLambdaConfiguration = lambdaConfigurations[newApiPath]
            || {};
          const lambdaProps = bundleLambdaProps(
            newDirectoryPath,
            userLambdaConfiguration,
            sharedLayer,
          );
          const newLambda = new lambda.Function(
            this,
            newDirectoryPath,
            lambdaProps,
          );

          // Pull out useAuthorizerLambda value and the tweaked model values
          const {
            useAuthorizerLambda: authorizerLambdaConfigured = false,
            requestModels: crowRequestModels,
            methodResponses: crowMethodResponses,
            requestValidator: requestValidatorString,
            ...userMethodConfiguration
          } = methodConfigurations[newApiPath] || {};
          let bundledMethodConfiguration: any = {
            ...userMethodConfiguration,
          };

          // Map models
          const requestModels: { [contentType: string]: apigateway.IModel } = {};
          if (crowRequestModels) {
            Object.entries(crowRequestModels).forEach(([contentType, modelName]) => {
              requestModels[contentType] = createdModels[modelName];
            });
          }

          const methodResponses: apigateway.MethodResponse[] = [];
          if (crowMethodResponses && crowMethodResponses.length > 0) {
            crowMethodResponses.forEach((crowMethodResponse) => {
              const responseModels: { [contentType: string]: apigateway.IModel } = {};
              if (crowMethodResponse.responseModels) {
                const crowResponseModels = crowMethodResponse.responseModels;
                Object.entries(crowResponseModels).forEach(([contentType, modelName]) => {
                  responseModels[contentType] = createdModels[modelName];
                });
              }

              const {
                statusCode,
                responseParameters,
              } = crowMethodResponse;
              methodResponses.push({
                statusCode,
                responseParameters,
                responseModels,
              });
            })
          }

          // Find request validator
          if (requestValidatorString
            && createdRequestValidators[requestValidatorString]) {
            bundledMethodConfiguration.requestValidator = createdRequestValidators[requestValidatorString];
          }

          bundledMethodConfiguration.requestModels = requestModels;
          bundledMethodConfiguration.methodResponses = methodResponses;
          // If this method should be behind an authorizer Lambda
          //   construct the methodConfiguration object as such
          if (authorizerLambdaConfigured && useAuthorizerLambda) {
            bundledMethodConfiguration.authorizationType = apigateway.AuthorizationType.CUSTOM;
            bundledMethodConfiguration.authorizer = tokenAuthorizer;
          }

          graph[apiPath].resource.addMethod(
            child.toUpperCase(),
            new apigateway.LambdaIntegration(newLambda),
            bundledMethodConfiguration,
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
    this.models = createdModels;
    this.requestValidators = createdRequestValidators;
  }
}
