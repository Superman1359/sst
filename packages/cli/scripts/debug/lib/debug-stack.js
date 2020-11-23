const fs = require("fs");
const cdk = require("@aws-cdk/core");
const apig = require("@aws-cdk/aws-apigatewayv2");
const lambda = require("@aws-cdk/aws-lambda");
const iam = require("@aws-cdk/aws-iam");
const dynamodb = require("@aws-cdk/aws-dynamodb");

class DebugStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { stage, name, region } = props;

    const _this = this;

    // Create connection table
    const table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "channel", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create API
    const api = new apig.CfnApi(this, "Api", {
      name: `${stage}-${name}-api`,
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    });
    const deployment = new apig.CfnDeployment(this, "ApiDeployment", {
      apiId: api.ref,
    });
    new apig.CfnStage(this, "ApiStage", {
      apiId: api.ref,
      autoDeploy: true,
      deploymentId: deployment.ref,
      stageName: stage,
    });

    addApiRoute({
      id: "Connect",
      routeKey: "$connect",
      codePath: "lambda/wsConnect.js",
    });
    addApiRoute({
      id: "Disconnect",
      routeKey: "$disconnect",
      codePath: "lambda/wsDisconnect.js",
    });
    addApiRoute({
      id: "Default",
      routeKey: "$default",
      codePath: "lambda/wsDefault.js",
    });

    new cdk.CfnOutput(this, "Endpoint", {
      value: `${api.attrApiEndpoint}/${stage}`,
    });

    function addApiRoute({ id, routeKey, codePath }) {
      // Create execution policy
      const policyStatement = new iam.PolicyStatement();
      policyStatement.addAllResources();
      policyStatement.addActions(
        "apigateway:*",
        "dynamodb:*",
        "execute-api:ManageConnections"
      );

      // Create Lambda
      const lambdaFunc = new lambda.Function(_this, id, {
        code: new lambda.InlineCode(
          fs.readFileSync(codePath, { encoding: "utf-8" })
        ),
        handler: "index.main",
        timeout: cdk.Duration.seconds(10),
        runtime: lambda.Runtime.NODEJS_12_X,
        memorySize: 256,
        environment: {
          TABLE_NAME: table.tableName,
        },
        initialPolicy: [policyStatement],
      });
      lambdaFunc.addPermission(`${id}Permission`, {
        principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      });

      // Create API integrations
      const integration = new apig.CfnIntegration(_this, `${id}Integration`, {
        apiId: api.ref,
        integrationType: "AWS_PROXY",
        integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaFunc.functionArn}/invocations`,
        //credentialsArn: role.roleArn,
      });

      // Create API routes
      const route = new apig.CfnRoute(_this, `${id}Route`, {
        apiId: api.ref,
        routeKey,
        authorizationType: "NONE",
        target: `integrations/${integration.ref}`,
      });
      deployment.node.addDependency(route);
    }
  }
}

module.exports = { DebugStack };
