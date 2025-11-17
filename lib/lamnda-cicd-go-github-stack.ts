import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as cpactions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";

export interface PipelineStackProps extends cdk.StackProps {
  githubOwner?: string;
  githubRepo?: string;
  branch?: string;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PipelineStackProps) {
    super(scope, id, props);

    const GITHUB_OWNER = props?.githubOwner ?? "freddysh";
    const GITHUB_REPO = props?.githubRepo ?? "lambda-cicd";
    const BRANCH = props?.branch ?? "main";

    // 1) Lambda function (initial code from asset 'lambda' for first deploy)
    const fn = new lambda.Function(this, "GoLambda", {
      functionName: "lambda-go-hola",
      runtime: lambda.Runtime.PROVIDED_AL2,
      handler: "bootstrap", // for custom runtime provided.al2
      code: lambda.Code.fromAsset("lambda"),
    });

    // create alias 'live' pointing to current version (so first deploy is stable)
    const alias = new lambda.Alias(this, "LiveAlias", {
      aliasName: "live",
      version: fn.currentVersion,
    });

    // 2) Build project (compilation)
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: "GoLambda-Build",
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.build.yml"),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // 3) Deploy project (runs aws cli update-function-code + publish-version + update-alias)
    const deployProject = new codebuild.PipelineProject(this, "DeployProject", {
      projectName: "GoLambda-Deploy",
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.deploy.yml"),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
    });

    // Give deploy project permission to update lambda
    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "lambda:UpdateFunctionCode",
          "lambda:PublishVersion",
          "lambda:UpdateAlias",
          "lambda:CreateAlias",
        ],
        resources: [fn.functionArn, `${fn.functionArn}:*`],
      })
    );

    // Give buildProject permission if needed (here not strictly necessary)
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: ["*"],
      })
    );

    // 4) Pipeline
    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "GoLambdaPipeline",
    });

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    // 4.a) Source action: GitHub (uses token in SecretsManager: 'github-token')
    pipeline.addStage({
      stageName: "Source",
      actions: [
        new cpactions.GitHubSourceAction({
          actionName: "GitHub_Source",
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          branch: BRANCH,
          oauthToken:  cdk.SecretValue.secretsManager("github-token", {
            jsonField: "github-token",
          }),
          output: sourceOutput,
        }),
      ],
    });

    // 4.b) Build action: compiles and outputs lambda.zip (artifact)
    pipeline.addStage({
      stageName: "Build",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "Build",
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    });

    // 4.c) Deploy action: CodeBuild runs aws cli to update lambda using buildOutput
    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "Deploy",
          project: deployProject,
          input: sourceOutput,   // ← ahora recibe el repo completo (incluyendo buildspec.deploy.yml)
          extraInputs: [buildOutput], // ← aquí recibe el lambda.zip
        }),
      ],
    });

    // Output helpful info
    new cdk.CfnOutput(this, "PipelineName", { value: pipeline.pipelineName });
    new cdk.CfnOutput(this, "LambdaName", { value: fn.functionName });
  }
}
