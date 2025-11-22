# AgentCore Runtime + API Gateway Response Streaming

Amazon Bedrock AgentCore RuntimeをAPI Gateway Response Streamingでラップして、ストリーミングAPIを構築するサンプルプロジェクトです。

## 概要

このプロジェクトは、以下の技術を組み合わせています：

- **Amazon Bedrock AgentCore**: AIエージェントをデプロイ・実行
- **AWS Lambda**: Response Streamingを使ってAgentCore Runtimeをプロキシ
- **Amazon API Gateway**: Response Streamingを使ってクライアントにストリーミングレスポンスを返却
- **AWS CDK**: インフラをコードで管理

## アーキテクチャ

```
クライアント
   ↓ (POST リクエスト)
API Gateway (Response Streaming有効)
   ↓ (Lambda Proxy統合)
Lambda関数 (Response Streaming対応)
   ↓ (InvokeAgentRuntime API)
AgentCore Runtime
   ↓ (ストリームレスポンス)
Lambda関数
   ↓ (SSE形式でストリーム)
API Gateway
   ↓ (そのままストリーミング)
クライアント
```

## 前提条件

- AWS CLI設定済み
- Node.js v20.x以降
- AWS CDK
- Python 3.13
- uvパッケージマネージャー

## プロジェクト構成

```
.
├── main.py                      # AgentCoreエージェント実装
├── pyproject.toml               # Pythonプロジェクト設定
├── .bedrock_agentcore.yaml      # AgentCore設定
└── cdk/
    ├── bin/
    │   └── cdk.ts               # CDKエントリーポイント
    ├── lib/
    │   └── cdk-stack.ts         # CDKスタック定義
    ├── lambda/
    │   └── agentcore-proxy/
    │       ├── index.ts         # Lambda関数実装
    │       ├── package.json
    │       └── tsconfig.json
    ├── agent/                   # AgentCoreエージェント（CDK用）
    ├── cdk.json                 # CDK設定
    ├── package.json
    └── tsconfig.json
```

## セットアップ

### 1. 依存関係のインストール

```bash
# CDKの依存関係
cd cdk
npm install

# Lambda関数の依存関係
cd lambda/agentcore-proxy
npm install
cd ../..

# Pythonの依存関係（AgentCore用）
cd ..
uv sync
```

### 2. CDKでデプロイ

```bash
cd cdk
cdk bootstrap  # 初回のみ
cdk deploy
```

デプロイが完了すると、以下の情報が出力されます：

```
Outputs:
AgentCoreProxyStack.RuntimeName = agentcore_runtime_xxxxx
AgentCoreProxyStack.RuntimeArn = arn:aws:bedrock-agentcore:us-west-2:...
AgentCoreProxyStack.RuntimeId = xxxxx
AgentCoreProxyStack.ProxyFunctionName = agentcore-proxy
AgentCoreProxyStack.ProxyFunctionArn = arn:aws:lambda:us-west-2:...
```

Lambda関数名をメモしておきます。

### 3. API Gatewayの設定（手動）

API Gateway Response Streamingを有効にするため、コンソールで以下を設定します：

1. API Gatewayコンソールを開く
2. REST APIを作成
3. `/invoke`リソースを作成
4. POSTメソッドを作成し、以下を設定：
   - 統合タイプ: Lambda関数
   - Lambdaプロキシ統合: オン
   - **レスポンス転送モード: ストリーム** ← 重要！
   - Lambda関数: `agentcore-proxy`
   - 統合のタイムアウト: 900000 (15分)
5. APIをデプロイ

## 使い方

### curlでのテスト

```bash
curl -X POST https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/prod/invoke \
  -H "Content-Type: application/json" \
  -d '{"prompt":"こんにちは、あなたは何ができますか？"}'
```

### レスポンス例（SSE形式）

```
data: {"event": {"messageStart": {"role": "assistant"}}}

data: {"event": {"contentBlockDelta": {"delta": {"text": "こんにちは"}, "contentBlockIndex": 0}}}

data: {"event": {"contentBlockDelta": {"delta": {"text": "！"}, "contentBlockIndex": 0}}}

...
```

## 主要な技術ポイント

### Lambda Response Streaming

```typescript
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEvent,
    responseStream: NodeJS.WritableStream,
    context: Context
  ) => {
    // ストリーミング処理
  }
);
```

### Server-Sent Events (SSE)

```typescript
const responseMetadata = {
  statusCode: 200,
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  },
};

const httpStream = awslambda.HttpResponseStream.from(
  responseStream as Writable,
  responseMetadata
);
```

### Stream Pipeline

```typescript
import { promisify } from 'util';
import { pipeline as streamPipeline, Readable } from 'stream';

const asyncPipeline = promisify(streamPipeline);

await asyncPipeline(runtimeResponse.response as Readable, httpStream);
```

## トラブルシューティング

### ストリーミングされない

**原因**: API Gatewayのレスポンス転送モードが`STREAM`になっていない

**解決策**: メソッド設定で「レスポンス転送モード」を「ストリーム」に設定

### タイムアウトエラー

**原因**: LambdaまたはAPI Gatewayのタイムアウトが短い

**解決策**: 両方とも900秒（15分）に設定

### AccessDeniedException

**原因**: LambdaのIAMロールにAgentCore Runtime呼び出し権限がない

**解決策**: CDKで自動的に付与されるはずですが、手動の場合は以下の権限を追加：

```json
{
  "Effect": "Allow",
  "Action": "bedrock-agentcore:InvokeAgentRuntime",
  "Resource": [
    "arn:aws:bedrock-agentcore:*:*:runtime/*",
    "arn:aws:bedrock-agentcore:*:*:runtime/*/runtime-endpoint/*"
  ]
}
```

## 制限事項

- Lambda最大実行時間: 15分
- AgentCore Runtime最大接続時間: 60分
- API Gatewayストリーム最大時間: 15分
- 初回6MB: 無制限帯域
- 6MB以降: 2MBps制限
- API Gatewayキャッシング: ストリーミング時は使用不可
- レスポンス変換（VTL）: ストリーミング時は使用不可

## 参考リンク

- [API Gateway Response Streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html)
- [Lambda Response Streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)
- [Building responsive APIs with Amazon API Gateway response streaming](https://aws.amazon.com/blogs/compute/building-responsive-apis-with-amazon-api-gateway-response-streaming/)

## ライセンス

MIT
