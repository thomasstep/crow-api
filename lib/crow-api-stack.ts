import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { CrowApi } from "../index";

export class CrowApiStack extends cdk.Stack {
  api: CrowApi;

  constructor(scope: Construct, id: string, props: any) {
    super(scope, id, props);

    const {
      crowApiProps,
    } = props;

    const api = new CrowApi(this, 'crow-auth-api', {
      ...crowApiProps,
    });

    this.api = api;
  }
}