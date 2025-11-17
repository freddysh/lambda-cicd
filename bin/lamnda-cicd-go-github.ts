#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { PipelineStack } from '../lib/lamnda-cicd-go-github-stack';

const app = new cdk.App();
new PipelineStack(app, "PipelineStack", {
  githubOwner: app.node.tryGetContext("githubOwner"),
  githubRepo: app.node.tryGetContext("githubRepo"),
  branch: app.node.tryGetContext("branch") ?? "main",
});
