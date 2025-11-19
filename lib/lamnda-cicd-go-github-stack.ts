import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as cpactions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: any) {
    super(scope, id, props);

    const fn = new lambda.Function(this, "GoLambda", {
      functionName: "lambda-go-hola",
      runtime: lambda.Runtime.PROVIDED_AL2,
      handler: "bootstrap",
      code: lambda.Code.fromAsset("lambda"),
    });

    const alias = new lambda.Alias(this, "LiveAlias", {
      aliasName: "live",
      version: fn.currentVersion,
    });

    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: "GoLambda-Build",
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.build.yml"),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0 },
    });

    const deployProject = new codebuild.PipelineProject(this, "DeployProject", {
      projectName: "GoLambda-Deploy",
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.deploy.yml"),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0 },
    });

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

    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "GoLambdaPipeline",
    });

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact("BuildArtifact");

    pipeline.addStage({
      stageName: "Source",
      actions: [
        new cpactions.GitHubSourceAction({
          actionName: "GitHub_Source",
          owner: "freddysh",
          repo: "lambda-cicd",
          branch: "main",
          output: sourceOutput,
          oauthToken: cdk.SecretValue.secretsManager("github-token", {
            jsonField: "github-token",
          }),
        }),
      ],
    });

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

    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new cpactions.CodeBuildAction({
          actionName: "Deploy",
          project: deployProject,
          input: buildOutput,
        }),
      ],
    });

    new cdk.CfnOutput(this, "LambdaName", { value: fn.functionName });
  }
}