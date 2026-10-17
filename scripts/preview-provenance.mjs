import { appendFileSync, writeFileSync } from "node:fs";

const [commit, output] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(commit ?? "") || !output) {
  throw new Error("Usage: node scripts/preview-provenance.mjs COMMIT OUTPUT");
}
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};
const server = required("GITHUB_SERVER_URL");
const repositorySlug = required("GITHUB_REPOSITORY");
const repository = `${server}/${repositorySlug}`;
const workflow = required("GITHUB_WORKFLOW_REF");
const workflowPath = workflow.slice(repositorySlug.length + 1).split("@")[0];
const ref = required("GITHUB_REF");
const workflowCommit = required("GITHUB_SHA");
const predicateType =
  "https://github.com/marimo-team/marimo-lens/blob/main/development_docs/release.md#preview-provenance-v1";

// workflow_run signs from the current main workflow, which can differ from the
// validated checkout. Record both dependencies and identify the artifact source.
const predicate = {
  buildDefinition: {
    buildType: predicateType,
    externalParameters: {
      workflow: { repository, ref, path: workflowPath },
      checkoutCommit: commit,
    },
    internalParameters: {
      github: {
        event_name: required("GITHUB_EVENT_NAME"),
        repository_id: required("GITHUB_REPOSITORY_ID"),
        repository_owner_id: required("GITHUB_REPOSITORY_OWNER_ID"),
        runner_environment: required("RUNNER_ENVIRONMENT"),
      },
    },
    resolvedDependencies: [
      { uri: `git+${repository}@${ref}`, digest: { gitCommit: workflowCommit } },
      { uri: `git+${repository}@${commit}`, digest: { gitCommit: commit } },
    ],
  },
  runDetails: {
    builder: { id: `${server}/${workflow}` },
    metadata: {
      invocationId: `${repository}/actions/runs/${required("GITHUB_RUN_ID")}/attempts/${required("GITHUB_RUN_ATTEMPT")}`,
    },
  },
};
writeFileSync(output, `${JSON.stringify(predicate, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `predicate_type=${predicateType}\n`);
}
