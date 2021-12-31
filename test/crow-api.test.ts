import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
// import { assert } from 'console';
import * as CrowApi from '../lib/crow-api-stack';

function getLogicalId(stack: cdk.Stack, resource: cdk.IResource) {
  return stack.getLogicalId(resource.node.findChild('Resource') as cdk.CfnElement);
}

function logicalIdFromResource(resource: any) {
  try {
    const resKeys = Object.keys(resource);
    if (resKeys.length !== 1) {
      throw new Error('Resource is not unique.');
    }
    const [logicalId] = resKeys;
    return logicalId;
  } catch (err) {
    console.log(resource);
    throw err;
  }
}

// This function would need work if there were path parts with the same name
function findApiGResourceByPath(template: Template, path: string) {
  const resource = template.findResources('AWS::ApiGateway::Resource', {
    Properties: {
      PathPart: path,
    },
  });
  return logicalIdFromResource(resource);
}

describe('Successful creation', () => {
  const app = new cdk.App();
  const stack = new CrowApi.CrowApiStack(app, 'MyTestStack', {
    crowApiProps: {
      sourceDirectory: 'test/testsrc',
      apiGatewayConfiguration: {
        restApiName: 'testing-crow-api',
      },
      useAuthorizerLambda: true,
      authorizerLambdaConfiguration: {
        timeout: cdk.Duration.seconds(20),
      },
      tokenAuthorizerConfiguration: {
        validationRegex: '^Bearer [-_A-Za-z0-9+/.]+={0,2}$',
        resultsCacheTtl: cdk.Duration.seconds(300),
      },
      createApiKey: true,
      logRetention: logs.RetentionDays.TWO_MONTHS,
      lambdaConfigurations: {
        '/v1/authors/get': {
          tracing: lambda.Tracing.ACTIVE,
        },
        '/v1/authors/post': {
          timeout: cdk.Duration.seconds(10),
        },
        '/v1/book/get': {
          environment: {
            HELLO: 'WORLD',
          },
        },
        '/v1/book/post': {
          description: '/v1/book/post',
        },
        '/v1/chapters/get': {
          memorySize: 1024,
        },
      },
      methodConfigurations: {
        '/v1/authors/get': {},
        '/v1/authors/post': {
          apiKeyRequired: true,
        },
        '/v1/book/get': {
          useAuthorizerLambda: true,
        },
        '/v1/book/post': {
          apiKeyRequired: true,
        },
        '/v1/chapters/get': {
          useAuthorizerLambda: true,
        },
      }
    },
  });
  const template = Template.fromStack(stack);

  const restApiLogicalId = getLogicalId(stack, stack.api.gateway);

  test('API Gateway created and apiGatewayConfiguration passed in', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'testing-crow-api',
    });
  });

  test('API Gateway Resources created', () => {
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      ParentId: {
        'Fn::GetAtt': [
          restApiLogicalId,
          'RootResourceId',
        ],
      },
      PathPart: 'v1',
      RestApiId: {
        Ref: restApiLogicalId,
      },
    });

    const v1LogicalId = findApiGResourceByPath(template, 'v1');

    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      ParentId: {
        Ref: v1LogicalId,
      },
      PathPart: 'authors',
      RestApiId: {
        Ref: restApiLogicalId,
      },
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      ParentId: {
        Ref: v1LogicalId,
      },
      PathPart: 'book',
      RestApiId: {
        Ref: restApiLogicalId,
      },
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      ParentId: {
        Ref: v1LogicalId,
      },
      PathPart: 'chapters',
      RestApiId: {
        Ref: restApiLogicalId,
      },
    });
  });

  test('Lambda Functions created', () => {
    // /v1/authors/get
    template.findResources('AWS::Lambda::Function', {
      Properties: {
        TracingConfig: {
          Mode: 'Active',
        },
      },
    });

    // /v1/authors/post
    template.findResources('AWS::Lambda::Function', {
      Properties: {
        Timeout: 10,
      },
    });

    // /v1/book/get
    template.findResources('AWS::Lambda::Function', {
      Properties: {
        Environment: {
          Variables: {
            HELLO: 'WORLD',
          },
        },
      },
    });

    // /v1/book/post
    template.findResources('AWS::Lambda::Function', {
        Properties: {
          Description: '/v1/book/post',
        },
    });

    // /v1/chapters/get
    template.findResources('AWS::Lambda::Function', {
      Properties: {
        MemorySize: 1024,
      },
    });

    // Authorizer Lambda
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 20,
    });
  });

  test('API Gateway Methods created and correctly mapped to Lambda Functions', () => {
    // Parent resource IDs
    const authorsLogicalId = findApiGResourceByPath(template, 'authors');
    const bookLogicalId = findApiGResourceByPath(template, 'book');
    const chaptersLogicalId = findApiGResourceByPath(template, 'chapters');

    // Find all Lambda Functions
    const v1AuthorsGetLambda = template.findResources('AWS::Lambda::Function', {
      Properties: {
        TracingConfig: {
          Mode: 'Active',
        },
      },
    });
    const v1AuthorsPostLambda = template.findResources('AWS::Lambda::Function', {
      Properties: {
        Timeout: 10,
      },
    });
    const v1BookGetLambda = template.findResources('AWS::Lambda::Function', {
      Properties: {
        Environment: {
          Variables: {
            HELLO: 'WORLD',
          },
        },
      },
    });
    const v1BookPostLambda = template.findResources('AWS::Lambda::Function', {
        Properties: {
          Description: '/v1/book/post',
        },
    });
    const v1ChaptersGetLambda = template.findResources('AWS::Lambda::Function', {
      Properties: {
        MemorySize: 1024,
      },
    });

    // Find Lambda Function Logical IDs
    const v1AuthorsGetLambdaLogicalId = logicalIdFromResource(v1AuthorsGetLambda);
    const v1AuthorsPostLambdaLogicalId = logicalIdFromResource(v1AuthorsPostLambda);
    const v1BookGetLambdaLogicalId = logicalIdFromResource(v1BookGetLambda);
    const v1BookPostLambdaLogicalId = logicalIdFromResource(v1BookPostLambda);
    const v1ChaptersGetLambdaLogicalId = logicalIdFromResource(v1ChaptersGetLambda);

    // Test that methods have the correct configuration passed down
    //   and are mapping to the correct Lambda
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      ResourceId: {
        Ref: authorsLogicalId,
      },
      RestApiId: {
        Ref: restApiLogicalId,
      },
      Integration: {
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':apigateway:',
              { Ref: 'AWS::Region' },
              ':lambda:path/2015-03-31/functions/',
              {
                'Fn::GetAtt': [
                  v1AuthorsGetLambdaLogicalId,
                  'Arn',
                ],
              },
              '/invocations',
            ],
          ],
        },
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      ResourceId: {
        Ref: authorsLogicalId,
      },
      RestApiId: {
        Ref: restApiLogicalId,
      },
      ApiKeyRequired: true,
      Integration: {
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':apigateway:',
              { Ref: 'AWS::Region' },
              ':lambda:path/2015-03-31/functions/',
              {
                'Fn::GetAtt': [
                  v1AuthorsPostLambdaLogicalId,
                  'Arn',
                ],
              },
              '/invocations',
            ],
          ],
        },
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      ResourceId: {
        Ref: bookLogicalId,
      },
      RestApiId: {
        Ref: restApiLogicalId,
      },
      AuthorizationType: 'CUSTOM',
      Integration: {
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':apigateway:',
              { Ref: 'AWS::Region' },
              ':lambda:path/2015-03-31/functions/',
              {
                'Fn::GetAtt': [
                  v1BookGetLambdaLogicalId,
                  'Arn',
                ],
              },
              '/invocations',
            ],
          ],
        },
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      ResourceId: {
        Ref: bookLogicalId,
      },
      RestApiId: {
        Ref: restApiLogicalId,
      },
      ApiKeyRequired: true,
      Integration: {
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':apigateway:',
              { Ref: 'AWS::Region' },
              ':lambda:path/2015-03-31/functions/',
              {
                'Fn::GetAtt': [
                  v1BookPostLambdaLogicalId,
                  'Arn',
                ],
              },
              '/invocations',
            ],
          ],
        },
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      ResourceId: {
        Ref: chaptersLogicalId,
      },
      RestApiId: {
        Ref: restApiLogicalId,
      },
      AuthorizationType: 'CUSTOM',
      Integration: {
        Uri: {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':apigateway:',
              { Ref: 'AWS::Region' },
              ':lambda:path/2015-03-31/functions/',
              {
                'Fn::GetAtt': [
                  v1ChaptersGetLambdaLogicalId,
                  'Arn',
                ],
              },
              '/invocations',
            ],
          ],
        },
      },
    });
  });
});
