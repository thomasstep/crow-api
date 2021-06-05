const cdk = require('@aws-cdk/core');
const { CrowApi } = require('./crow-api.js');

class CrowApiStack extends cdk.Stack {
  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    new CrowApi(this, 'my-crow-api', {
      ...props,
    });
  }
}

module.exports = { CrowApiStack }
