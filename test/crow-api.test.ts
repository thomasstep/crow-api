import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { assert } from 'console';
import * as CrowApi from '../lib/crow-api-stack';

function getLogicalId(stack: cdk.Stack, resource: cdk.IResource) {
  return stack.getLogicalId(resource.node.findChild('Resource') as cdk.CfnElement);
}

// This function would need work if there were path parts with the same name
function findApiGResourceByPath(template: Template, path: string) {
  const resource = template.findResources('AWS::ApiGateway::Resource', {
    Properties: {
      PathPart: path,
    },
  });
  const resKeys = Object.keys(resource);
  if (resKeys.length !== 1) {
    assert(false, `Could not find /${path} resource.`);
  }
  const [logicalId] = resKeys;
  return logicalId;
}

test('API Created', () => {
  const app = new cdk.App();

  // WHEN
  const stack = new CrowApi.CrowApiStack(app, 'MyTestStack', {
    crowApiProps: {
      sourceDirectory: 'test/testsrc',
      apiGatewayConfiguration: {
        restApiName: 'testing-crow-api',
      },
    },
  });

  // THEN
  const template = Template.fromStack(stack);

  const restApiLogicalId = getLogicalId(stack, stack.api.gateway)

  // --------------------------------------------------------------------------
  // Check API Gateway
  // --------------------------------------------------------------------------

  template.hasResourceProperties('AWS::ApiGateway::RestApi', {
    Name: 'testing-crow-api',
  });

  // --------------------------------------------------------------------------
  // Check resources to make sure that they are all correct
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Check methods to make sure that they are all correct
  // --------------------------------------------------------------------------

  const authorsLogicalId = findApiGResourceByPath(template, 'authors');
  const bookLogicalId = findApiGResourceByPath(template, 'book');
  const chaptersLogicalId = findApiGResourceByPath(template, 'chapters');

  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'GET',
    ResourceId: {
      Ref: authorsLogicalId,
    },
    RestApiId: {
      Ref: restApiLogicalId,
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
  });

  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'GET',
    ResourceId: {
      Ref: bookLogicalId,
    },
    RestApiId: {
      Ref: restApiLogicalId,
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
  });

  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'GET',
    ResourceId: {
      Ref: chaptersLogicalId,
    },
    RestApiId: {
      Ref: restApiLogicalId,
    },
  });
});
