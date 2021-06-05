const cdk = require('@aws-cdk/core');
const dynamodb = require('@aws-cdk/aws-dynamodb');

class TablesStack extends cdk.Stack {
  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);
    const primaryTable = new dynamodb.Table(this, 'crow-api-primary-table', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sort',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    this.primaryTable = primaryTable;
  }
}

module.exports = { TablesStack }
