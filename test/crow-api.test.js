"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const logs = require("aws-cdk-lib/aws-logs");
const assertions_1 = require("aws-cdk-lib/assertions");
// import { assert } from 'console';
const CrowApi = require("../lib/crow-api-stack");
function getLogicalId(stack, resource) {
    return stack.getLogicalId(resource.node.findChild('Resource'));
}
function logicalIdFromResource(resource) {
    try {
        const resKeys = Object.keys(resource);
        if (resKeys.length !== 1) {
            throw new Error('Resource is not unique.');
        }
        const [logicalId] = resKeys;
        return logicalId;
    }
    catch (err) {
        console.log(resource);
        throw err;
    }
}
// This function would need work if there were path parts with the same name
function findApiGResourceByPath(template, path) {
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
            models: [
                {
                    modelName: 'authorsPost',
                    schema: {
                        schema: apigateway.JsonSchemaVersion.DRAFT4,
                        title: '/v1/authors/post',
                        type: apigateway.JsonSchemaType.OBJECT,
                        required: ['name'],
                        properties: {
                            name: {
                                type: apigateway.JsonSchemaType.STRING,
                            },
                        },
                    },
                },
            ],
            methodConfigurations: {
                '/v1/authors/get': {},
                '/v1/authors/post': {
                    apiKeyRequired: true,
                    requestModels: {
                        'application/json': 'authorsPost',
                    },
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
    const template = assertions_1.Template.fromStack(stack);
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
        // Find Models
        const authorsPostModel = template.findResources('AWS::ApiGateway::Model', {
            Properties: {
                RestApiId: {
                    Ref: restApiLogicalId,
                },
                Name: 'authorsPost',
            },
        });
        const authorsPostModelLogicalId = logicalIdFromResource(authorsPostModel);
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
            RequestModels: {
                'application/json': {
                    Ref: authorsPostModelLogicalId,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY3Jvdy1hcGkudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNyb3ctYXBpLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBbUM7QUFDbkMseURBQXlEO0FBQ3pELGlEQUFpRDtBQUNqRCw2Q0FBNkM7QUFDN0MsdURBQWtEO0FBQ2xELG9DQUFvQztBQUNwQyxpREFBaUQ7QUFFakQsU0FBUyxZQUFZLENBQUMsS0FBZ0IsRUFBRSxRQUF1QjtJQUM3RCxPQUFPLEtBQUssQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFtQixDQUFDLENBQUM7QUFDbkYsQ0FBQztBQUVELFNBQVMscUJBQXFCLENBQUMsUUFBYTtJQUMxQyxJQUFJO1FBQ0YsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUN0QyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1lBQ3hCLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQztTQUM1QztRQUNELE1BQU0sQ0FBQyxTQUFTLENBQUMsR0FBRyxPQUFPLENBQUM7UUFDNUIsT0FBTyxTQUFTLENBQUM7S0FDbEI7SUFBQyxPQUFPLEdBQUcsRUFBRTtRQUNaLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDdEIsTUFBTSxHQUFHLENBQUM7S0FDWDtBQUNILENBQUM7QUFFRCw0RUFBNEU7QUFDNUUsU0FBUyxzQkFBc0IsQ0FBQyxRQUFrQixFQUFFLElBQVk7SUFDOUQsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQywyQkFBMkIsRUFBRTtRQUNuRSxVQUFVLEVBQUU7WUFDVixRQUFRLEVBQUUsSUFBSTtTQUNmO0tBQ0YsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUN6QyxDQUFDO0FBRUQsUUFBUSxDQUFD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LGFBQWEsRUFBRTs0QkFDdEIsb0NBQW9DOzRCQUNwQztnQ0FDRSxZQUFZLEVBQUU7b0NBQ1oseUJBQXlCO29DQUN6QixLQUFLO2lDQUNOOzZCQUNGOzRCQUNELGNBQWM7eUJBQ2Y7cUJBQ0Y7aUJBQ0Y7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyx5QkFBeUIsRUFBRTtZQUN4RCxVQUFVLEVBQUUsS0FBSztZQUNqQixVQUFVLEVBQUU7Z0JBQ1YsR0FBRyxFQUFFLGlCQUFpQjthQUN2QjtZQUNELFNBQVMsRUFBRTtnQkFDVCxHQUFHLEVBQUUsZ0JBQWdCO2FBQ3RCO1lBQ0QsaUJBQWlCLEVBQUUsUUFBUTtZQUMzQixXQUFXLEVBQUU7Z0JBQ1gsR0FBRyxFQUFFO29CQUNILFVBQVUsRUFBRTt3QkFDVixFQUFFO3dCQUNGOzRCQUNFLE1BQU07NEJBQ04sRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7NEJBQ3pCLGNBQWM7NEJBQ2QsRUFBRSxHQUFHLEVBQUUsYUFBYSxFQUFFOzRCQUN0QixvQ0FBb0M7NEJBQ3BDO2dDQUNFLFlBQVksRUFBRTtvQ0FDWiw0QkFBNEI7b0NBQzVCLEtBQUs7aUNBQ047NkJBQ0Y7NEJBQ0QsY0FBYzt5QkFDZjtxQkFDRjtpQkFDRjthQUNGO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgVGVtcGxhdGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbi8vIGltcG9ydCB7IGFzc2VydCB9IGZyb20gJ2NvbnNvbGUnO1xuaW1wb3J0ICogYXMgQ3Jvd0FwaSBmcm9tICcuLi9saWIvY3Jvdy1hcGktc3RhY2snO1xuXG5mdW5jdGlvbiBnZXRMb2dpY2FsSWQoc3RhY2s6IGNkay5TdGFjaywgcmVzb3VyY2U6IGNkay5JUmVzb3VyY2UpIHtcbiAgcmV0dXJuIHN0YWNrLmdldExvZ2ljYWxJZChyZXNvdXJjZS5ub2RlLmZpbmRDaGlsZCgnUmVzb3VyY2UnKSBhcyBjZGsuQ2ZuRWxlbWVudCk7XG59XG5cbmZ1bmN0aW9uIGxvZ2ljYWxJZEZyb21SZXNvdXJjZShyZXNvdXJjZTogYW55KSB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzS2V5cyA9IE9iamVjdC5rZXlzKHJlc291cmNlKTtcbiAgICBpZiAocmVzS2V5cy5sZW5ndGggIT09IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVzb3VyY2UgaXMgbm90IHVuaXF1ZS4nKTtcbiAgICB9XG4gICAgY29uc3QgW2xvZ2ljYWxJZF0gPSByZXNLZXlzO1xuICAgIHJldHVybiBsb2dpY2FsSWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUubG9nKHJlc291cmNlKTtcbiAgICB0aHJvdyBlcnI7XG4gIH1cbn1cblxuLy8gVGhpcyBmdW5jdGlvbiB3b3VsZCBuZWVkIHdvcmsgaWYgdGhlcmUgd2VyZSBwYXRoIHBhcnRzIHdpdGggdGhlIHNhbWUgbmFtZVxuZnVuY3Rpb24gZmluZEFwaUdSZXNvdXJjZUJ5UGF0aCh0ZW1wbGF0ZTogVGVtcGxhdGUsIHBhdGg6IHN0cmluZykge1xuICBjb25zdCByZXNvdXJjZSA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6QXBpR2F0ZXdheTo6UmVzb3VyY2UnLCB7XG4gICAgUHJvcGVydGllczoge1xuICAgICAgUGF0aFBhcnQ6IHBhdGgsXG4gICAgfSxcbiAgfSk7XG4gIHJldHVybiBsb2dpY2FsSWRGcm9tUmVzb3VyY2UocmVzb3VyY2UpO1xufVxuXG5kZXNjcmliZSgnU3VjY2Vzc2Z1bCBjcmVhdGlvbicsICgpID0+IHtcbiAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgQ3Jvd0FwaS5Dcm93QXBpU3RhY2soYXBwLCAnTXlUZXN0U3RhY2snLCB7XG4gICAgY3Jvd0FwaVByb3BzOiB7XG4gICAgICBzb3VyY2VEaXJlY3Rvcnk6ICd0ZXN0L3Rlc3RzcmMnLFxuICAgICAgYXBpR2F0ZXdheUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgcmVzdEFwaU5hbWU6ICd0ZXN0aW5nLWNyb3ctYXBpJyxcbiAgICAgIH0sXG4gICAgICB1c2VBdXRob3JpemVyTGFtYmRhOiB0cnVlLFxuICAgICAgYXV0aG9yaXplckxhbWJkYUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMjApLFxuICAgICAgfSxcbiAgICAgIHRva2VuQXV0aG9yaXplckNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgdmFsaWRhdGlvblJlZ2V4OiAnXkJlYXJlciBbLV9BLVphLXowLTkrLy5dKz17MCwyfSQnLFxuICAgICAgICByZXN1bHRzQ2FjaGVUdGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICB9LFxuICAgICAgY3JlYXRlQXBpS2V5OiB0cnVlLFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuVFdPX01PTlRIUyxcbiAgICAgIGxhbWJkYUNvbmZpZ3VyYXRpb25zOiB7XG4gICAgICAgICcvdjEvYXV0aG9ycy9nZXQnOiB7XG4gICAgICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgICB9LFxuICAgICAgICAnL3YxL2F1dGhvcnMvcG9zdCc6IHtcbiAgICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXG4gICAgICAgIH0sXG4gICAgICAgICcvdjEvYm9vay9nZXQnOiB7XG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgIEhFTExPOiAnV09STEQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgICcvdjEvYm9vay9wb3N0Jzoge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnL3YxL2Jvb2svcG9zdCcsXG4gICAgICAgIH0sXG4gICAgICAgICcvdjEvY2hhcHRlcnMvZ2V0Jzoge1xuICAgICAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgbW9kZWxzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBtb2RlbE5hbWU6ICdhdXRob3JzUG9zdCcsXG4gICAgICAgICAgc2NoZW1hOiB7XG4gICAgICAgICAgICBzY2hlbWE6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVZlcnNpb24uRFJBRlQ0LFxuICAgICAgICAgICAgdGl0bGU6ICcvdjEvYXV0aG9ycy9wb3N0JyxcbiAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuT0JKRUNULFxuICAgICAgICAgICAgcmVxdWlyZWQ6IFsnbmFtZSddLFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBuYW1lOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgbWV0aG9kQ29uZmlndXJhdGlvbnM6IHtcbiAgICAgICAgJy92MS9hdXRob3JzL2dldCc6IHt9LFxuICAgICAgICAnL3YxL2F1dGhvcnMvcG9zdCc6IHtcbiAgICAgICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgICByZXF1ZXN0TW9kZWxzOiB7XG4gICAgICAgICAgICAnYXBwbGljYXRpb24vanNvbic6ICdhdXRob3JzUG9zdCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgJy92MS9ib29rL2dldCc6IHtcbiAgICAgICAgICB1c2VBdXRob3JpemVyTGFtYmRhOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICAnL3YxL2Jvb2svcG9zdCc6IHtcbiAgICAgICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgJy92MS9jaGFwdGVycy9nZXQnOiB7XG4gICAgICAgICAgdXNlQXV0aG9yaXplckxhbWJkYTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICB9LFxuICB9KTtcbiAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuXG4gIGNvbnN0IHJlc3RBcGlMb2dpY2FsSWQgPSBnZXRMb2dpY2FsSWQoc3RhY2ssIHN0YWNrLmFwaS5nYXRld2F5KTtcblxuICB0ZXN0KCdBUEkgR2F0ZXdheSBjcmVhdGVkIGFuZCBhcGlHYXRld2F5Q29uZmlndXJhdGlvbiBwYXNzZWQgaW4nLCAoKSA9PiB7XG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6OlJlc3RBcGknLCB7XG4gICAgICBOYW1lOiAndGVzdGluZy1jcm93LWFwaScsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHRlc3QoJ0FQSSBHYXRld2F5IFJlc291cmNlcyBjcmVhdGVkJywgKCkgPT4ge1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXNvdXJjZScsIHtcbiAgICAgIFBhcmVudElkOiB7XG4gICAgICAgICdGbjo6R2V0QXR0JzogW1xuICAgICAgICAgIHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICAgICAgJ1Jvb3RSZXNvdXJjZUlkJyxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICBQYXRoUGFydDogJ3YxJyxcbiAgICAgIFJlc3RBcGlJZDoge1xuICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgdjFMb2dpY2FsSWQgPSBmaW5kQXBpR1Jlc291cmNlQnlQYXRoKHRlbXBsYXRlLCAndjEnKTtcblxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXNvdXJjZScsIHtcbiAgICAgIFBhcmVudElkOiB7XG4gICAgICAgIFJlZjogdjFMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgICAgUGF0aFBhcnQ6ICdhdXRob3JzJyxcbiAgICAgIFJlc3RBcGlJZDoge1xuICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXNvdXJjZScsIHtcbiAgICAgIFBhcmVudElkOiB7XG4gICAgICAgIFJlZjogdjFMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgICAgUGF0aFBhcnQ6ICdib29rJyxcbiAgICAgIFJlc3RBcGlJZDoge1xuICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXNvdXJjZScsIHtcbiAgICAgIFBhcmVudElkOiB7XG4gICAgICAgIFJlZjogdjFMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgICAgUGF0aFBhcnQ6ICdjaGFwdGVycycsXG4gICAgICBSZXN0QXBpSWQ6IHtcbiAgICAgICAgUmVmOiByZXN0QXBpTG9naWNhbElkLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnTGFtYmRhIEZ1bmN0aW9ucyBjcmVhdGVkJywgKCkgPT4ge1xuICAgIC8vIC92MS9hdXRob3JzL2dldFxuICAgIHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgVHJhY2luZ0NvbmZpZzoge1xuICAgICAgICAgIE1vZGU6ICdBY3RpdmUnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIC92MS9hdXRob3JzL3Bvc3RcbiAgICB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIFRpbWVvdXQ6IDEwLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIC92MS9ib29rL2dldFxuICAgIHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IHtcbiAgICAgICAgICAgIEhFTExPOiAnV09STEQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gL3YxL2Jvb2svcG9zdFxuICAgIHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgIERlc2NyaXB0aW9uOiAnL3YxL2Jvb2svcG9zdCcsXG4gICAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyAvdjEvY2hhcHRlcnMvZ2V0XG4gICAgdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBNZW1vcnlTaXplOiAxMDI0LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEF1dGhvcml6ZXIgTGFtYmRhXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICBUaW1lb3V0OiAyMCxcbiAgICB9KTtcbiAgfSk7XG5cbiAgdGVzdCgnQVBJIEdhdGV3YXkgTWV0aG9kcyBjcmVhdGVkIGFuZCBjb3JyZWN0bHkgbWFwcGVkIHRvIExhbWJkYSBGdW5jdGlvbnMnLCAoKSA9PiB7XG4gICAgLy8gUGFyZW50IHJlc291cmNlIElEc1xuICAgIGNvbnN0IGF1dGhvcnNMb2dpY2FsSWQgPSBmaW5kQXBpR1Jlc291cmNlQnlQYXRoKHRlbXBsYXRlLCAnYXV0aG9ycycpO1xuICAgIGNvbnN0IGJvb2tMb2dpY2FsSWQgPSBmaW5kQXBpR1Jlc291cmNlQnlQYXRoKHRlbXBsYXRlLCAnYm9vaycpO1xuICAgIGNvbnN0IGNoYXB0ZXJzTG9naWNhbElkID0gZmluZEFwaUdSZXNvdXJjZUJ5UGF0aCh0ZW1wbGF0ZSwgJ2NoYXB0ZXJzJyk7XG5cbiAgICAvLyBGaW5kIGFsbCBMYW1iZGEgRnVuY3Rpb25zXG4gICAgY29uc3QgdjFBdXRob3JzR2V0TGFtYmRhID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBUcmFjaW5nQ29uZmlnOiB7XG4gICAgICAgICAgTW9kZTogJ0FjdGl2ZScsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGNvbnN0IHYxQXV0aG9yc1Bvc3RMYW1iZGEgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIFRpbWVvdXQ6IDEwLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBjb25zdCB2MUJvb2tHZXRMYW1iZGEgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgIEVudmlyb25tZW50OiB7XG4gICAgICAgICAgVmFyaWFibGVzOiB7XG4gICAgICAgICAgICBIRUxMTzogJ1dPUkxEJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBjb25zdCB2MUJvb2tQb3N0TGFtYmRhID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgRGVzY3JpcHRpb246ICcvdjEvYm9vay9wb3N0JyxcbiAgICAgICAgfSxcbiAgICB9KTtcbiAgICBjb25zdCB2MUNoYXB0ZXJzR2V0TGFtYmRhID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBNZW1vcnlTaXplOiAxMDI0LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEZpbmQgTGFtYmRhIEZ1bmN0aW9uIExvZ2ljYWwgSURzXG4gICAgY29uc3QgdjFBdXRob3JzR2V0TGFtYmRhTG9naWNhbElkID0gbG9naWNhbElkRnJvbVJlc291cmNlKHYxQXV0aG9yc0dldExhbWJkYSk7XG4gICAgY29uc3QgdjFBdXRob3JzUG9zdExhbWJkYUxvZ2ljYWxJZCA9IGxvZ2ljYWxJZEZyb21SZXNvdXJjZSh2MUF1dGhvcnNQb3N0TGFtYmRhKTtcbiAgICBjb25zdCB2MUJvb2tHZXRMYW1iZGFMb2dpY2FsSWQgPSBsb2dpY2FsSWRGcm9tUmVzb3VyY2UodjFCb29rR2V0TGFtYmRhKTtcbiAgICBjb25zdCB2MUJvb2tQb3N0TGFtYmRhTG9naWNhbElkID0gbG9naWNhbElkRnJvbVJlc291cmNlKHYxQm9va1Bvc3RMYW1iZGEpO1xuICAgIGNvbnN0IHYxQ2hhcHRlcnNHZXRMYW1iZGFMb2dpY2FsSWQgPSBsb2dpY2FsSWRGcm9tUmVzb3VyY2UodjFDaGFwdGVyc0dldExhbWJkYSk7XG5cbiAgICAvLyBGaW5kIE1vZGVsc1xuICAgIGNvbnN0IGF1dGhvcnNQb3N0TW9kZWwgPSB0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OkFwaUdhdGV3YXk6Ok1vZGVsJywge1xuICAgICAgUHJvcGVydGllczoge1xuICAgICAgICBSZXN0QXBpSWQ6IHtcbiAgICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICAgIH0sXG4gICAgICAgIE5hbWU6ICdhdXRob3JzUG9zdCcsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGNvbnN0IGF1dGhvcnNQb3N0TW9kZWxMb2dpY2FsSWQgPSBsb2dpY2FsSWRGcm9tUmVzb3VyY2UoYXV0aG9yc1Bvc3RNb2RlbCk7XG5cbiAgICAvLyBUZXN0IHRoYXQgbWV0aG9kcyBoYXZlIHRoZSBjb3JyZWN0IGNvbmZpZ3VyYXRpb24gcGFzc2VkIGRvd25cbiAgICAvLyAgIGFuZCBhcmUgbWFwcGluZyB0byB0aGUgY29ycmVjdCBMYW1iZGFcbiAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6QXBpR2F0ZXdheTo6TWV0aG9kJywge1xuICAgICAgSHR0cE1ldGhvZDogJ0dFVCcsXG4gICAgICBSZXNvdXJjZUlkOiB7XG4gICAgICAgIFJlZjogYXV0aG9yc0xvZ2ljYWxJZCxcbiAgICAgIH0sXG4gICAgICBSZXN0QXBpSWQ6IHtcbiAgICAgICAgUmVmOiByZXN0QXBpTG9naWNhbElkLFxuICAgICAgfSxcbiAgICAgIEludGVncmF0aW9uOiB7XG4gICAgICAgIFVyaToge1xuICAgICAgICAgICdGbjo6Sm9pbic6IFtcbiAgICAgICAgICAgICcnLFxuICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAnYXJuOicsXG4gICAgICAgICAgICAgIHsgUmVmOiAnQVdTOjpQYXJ0aXRpb24nIH0sXG4gICAgICAgICAgICAgICc6YXBpZ2F0ZXdheTonLFxuICAgICAgICAgICAgICB7IFJlZjogJ0FXUzo6UmVnaW9uJyB9LFxuICAgICAgICAgICAgICAnOmxhbWJkYTpwYXRoLzIwMTUtMDMtMzEvZnVuY3Rpb25zLycsXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAnRm46OkdldEF0dCc6IFtcbiAgICAgICAgICAgICAgICAgIHYxQXV0aG9yc0dldExhbWJkYUxvZ2ljYWxJZCxcbiAgICAgICAgICAgICAgICAgICdBcm4nLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICcvaW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpNZXRob2QnLCB7XG4gICAgICBIdHRwTWV0aG9kOiAnUE9TVCcsXG4gICAgICBSZXNvdXJjZUlkOiB7XG4gICAgICAgIFJlZjogYXV0aG9yc0xvZ2ljYWxJZCxcbiAgICAgIH0sXG4gICAgICBSZXN0QXBpSWQ6IHtcbiAgICAgICAgUmVmOiByZXN0QXBpTG9naWNhbElkLFxuICAgICAgfSxcbiAgICAgIEFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgICAgSW50ZWdyYXRpb246IHtcbiAgICAgICAgVXJpOiB7XG4gICAgICAgICAgJ0ZuOjpKb2luJzogW1xuICAgICAgICAgICAgJycsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICdhcm46JyxcbiAgICAgICAgICAgICAgeyBSZWY6ICdBV1M6OlBhcnRpdGlvbicgfSxcbiAgICAgICAgICAgICAgJzphcGlnYXRld2F5OicsXG4gICAgICAgICAgICAgIHsgUmVmOiAnQVdTOjpSZWdpb24nIH0sXG4gICAgICAgICAgICAgICc6bGFtYmRhOnBhdGgvMjAxNS0wMy0zMS9mdW5jdGlvbnMvJyxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICdGbjo6R2V0QXR0JzogW1xuICAgICAgICAgICAgICAgICAgdjFBdXRob3JzUG9zdExhbWJkYUxvZ2ljYWxJZCxcbiAgICAgICAgICAgICAgICAgICdBcm4nLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICcvaW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIFJlcXVlc3RNb2RlbHM6IHtcbiAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiB7XG4gICAgICAgICAgUmVmOiBhdXRob3JzUG9zdE1vZGVsTG9naWNhbElkLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpNZXRob2QnLCB7XG4gICAgICBIdHRwTWV0aG9kOiAnR0VUJyxcbiAgICAgIFJlc291cmNlSWQ6IHtcbiAgICAgICAgUmVmOiBib29rTG9naWNhbElkLFxuICAgICAgfSxcbiAgICAgIFJlc3RBcGlJZDoge1xuICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgICAgQXV0aG9yaXphdGlvblR5cGU6ICdDVVNUT00nLFxuICAgICAgSW50ZWdyYXRpb246IHtcbiAgICAgICAgVXJpOiB7XG4gICAgICAgICAgJ0ZuOjpKb2luJzogW1xuICAgICAgICAgICAgJycsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICdhcm46JyxcbiAgICAgICAgICAgICAgeyBSZWY6ICdBV1M6OlBhcnRpdGlvbicgfSxcbiAgICAgICAgICAgICAgJzphcGlnYXRld2F5OicsXG4gICAgICAgICAgICAgIHsgUmVmOiAnQVdTOjpSZWdpb24nIH0sXG4gICAgICAgICAgICAgICc6bGFtYmRhOnBhdGgvMjAxNS0wMy0zMS9mdW5jdGlvbnMvJyxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICdGbjo6R2V0QXR0JzogW1xuICAgICAgICAgICAgICAgICAgdjFCb29rR2V0TGFtYmRhTG9naWNhbElkLFxuICAgICAgICAgICAgICAgICAgJ0FybicsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgJy9pbnZvY2F0aW9ucycsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6Ok1ldGhvZCcsIHtcbiAgICAgIEh0dHBNZXRob2Q6ICdQT1NUJyxcbiAgICAgIFJlc291cmNlSWQ6IHtcbiAgICAgICAgUmVmOiBib29rTG9naWNhbElkLFxuICAgICAgfSxcbiAgICAgIFJlc3RBcGlJZDoge1xuICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgICAgQXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgICBJbnRlZ3JhdGlvbjoge1xuICAgICAgICBVcmk6IHtcbiAgICAgICAgICAnRm46OkpvaW4nOiBbXG4gICAgICAgICAgICAnJyxcbiAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgJ2FybjonLFxuICAgICAgICAgICAgICB7IFJlZjogJ0FXUzo6UGFydGl0aW9uJyB9LFxuICAgICAgICAgICAgICAnOmFwaWdhdGV3YXk6JyxcbiAgICAgICAgICAgICAgeyBSZWY6ICdBV1M6OlJlZ2lvbicgfSxcbiAgICAgICAgICAgICAgJzpsYW1iZGE6cGF0aC8yMDE1LTAzLTMxL2Z1bmN0aW9ucy8nLFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgJ0ZuOjpHZXRBdHQnOiBbXG4gICAgICAgICAgICAgICAgICB2MUJvb2tQb3N0TGFtYmRhTG9naWNhbElkLFxuICAgICAgICAgICAgICAgICAgJ0FybicsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgJy9pbnZvY2F0aW9ucycsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkFwaUdhdGV3YXk6Ok1ldGhvZCcsIHtcbiAgICAgIEh0dHBNZXRob2Q6ICdHRVQnLFxuICAgICAgUmVzb3VyY2VJZDoge1xuICAgICAgICBSZWY6IGNoYXB0ZXJzTG9naWNhbElkLFxuICAgICAgfSxcbiAgICAgIFJlc3RBcGlJZDoge1xuICAgICAgICBSZWY6IHJlc3RBcGlMb2dpY2FsSWQsXG4gICAgICB9LFxuICAgICAgQXV0aG9yaXphdGlvblR5cGU6ICdDVVNUT00nLFxuICAgICAgSW50ZWdyYXRpb246IHtcbiAgICAgICAgVXJpOiB7XG4gICAgICAgICAgJ0ZuOjpKb2luJzogW1xuICAgICAgICAgICAgJycsXG4gICAgICAgICAgICBbXG4gICAgICAgICAgICAgICdhcm46JyxcbiAgICAgICAgICAgICAgeyBSZWY6ICdBV1M6OlBhcnRpdGlvbicgfSxcbiAgICAgICAgICAgICAgJzphcGlnYXRld2F5OicsXG4gICAgICAgICAgICAgIHsgUmVmOiAnQVdTOjpSZWdpb24nIH0sXG4gICAgICAgICAgICAgICc6bGFtYmRhOnBhdGgvMjAxNS0wMy0zMS9mdW5jdGlvbnMvJyxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICdGbjo6R2V0QXR0JzogW1xuICAgICAgICAgICAgICAgICAgdjFDaGFwdGVyc0dldExhbWJkYUxvZ2ljYWxJZCxcbiAgICAgICAgICAgICAgICAgICdBcm4nLFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICcvaW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==