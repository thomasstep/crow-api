#!/usr/bin/env node

const cdk = require('@aws-cdk/core');
const { CrowApiStack } = require('../lib/crow-api-stack');

const devEnvironment = {
  account: '712578128737',
  region: 'us-east-1',
};

const app = new cdk.App();

new CrowApiStack(app, 'CrowApiStack', {
  env: devEnvironment,
  sourceDirectory: 'src',
  sharedDirectory: 'utils',
  createApiKey: true,
});
