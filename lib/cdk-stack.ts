import * as cdk from "aws-cdk-lib";
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { Construct } from "constructs";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =====================
    // AgentCore Runtime
    // =====================

    // ローカルのコードをビルド
    const agentRuntimeArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
      path.join(__dirname, "../agent"),
    );

    // ランダムなAgent名を生成
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const runtimeName = `agentcore_runtime_${randomSuffix}`;

    // AgentCore Runtime を作成
    const runtime = new agentcore.Runtime(this, "AgentCoreRuntime", {
      runtimeName: runtimeName,
      agentRuntimeArtifact: agentRuntimeArtifact,
      description: "Strands Agent deployed via CDK L2 Construct",
    });

    // Bedrock の呼び出し権限を追加
    runtime.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/*`],
      }),
    );

    // =====================
    // Lambda 関数（AgentCore Proxy）
    // =====================

    // Lambda 関数用のロググループ
    const lambdaLogGroup = new logs.LogGroup(this, "LambdaLogGroup", {
      logGroupName: "/aws/lambda/agentcore-proxy",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda関数の作成
    const proxyFunction = new nodejs.NodejsFunction(
      this,
      "AgentCoreProxyFunction",
      {
        functionName: "agentcore-proxy",
        entry: path.join(__dirname, "../lambda/agentcore-proxy/index.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: cdk.Duration.minutes(15),
        memorySize: 512,
        environment: {
          AGENT_ARN: runtime.agentRuntimeArn,
        },
        logGroup: lambdaLogGroup,
      },
    );

    // AgentCore Runtime呼び出し権限を付与
    proxyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [
          runtime.agentRuntimeArn,
          `${runtime.agentRuntimeArn}/runtime-endpoint/*`,
        ],
      }),
    );

    // =====================
    // Outputs
    // =====================

    new cdk.CfnOutput(this, "RuntimeName", {
      value: runtimeName,
      description: "Name of the AgentCore Runtime",
    });

    new cdk.CfnOutput(this, "RuntimeArn", {
      value: runtime.agentRuntimeArn,
      description: "ARN of the AgentCore Runtime",
    });

    new cdk.CfnOutput(this, "RuntimeId", {
      value: runtime.agentRuntimeId,
      description: "ID of the AgentCore Runtime",
    });

    new cdk.CfnOutput(this, "ProxyFunctionName", {
      value: proxyFunction.functionName,
      description: "AgentCore Proxy Lambda Function Name",
    });

    new cdk.CfnOutput(this, "ProxyFunctionArn", {
      value: proxyFunction.functionArn,
      description: "AgentCore Proxy Lambda Function ARN",
    });
  }
}
