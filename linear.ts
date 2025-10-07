import { LinearClient } from "@linear/sdk";

const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });

/** List the 50 most recently updated issues ("stories") across the workspace */
export async function listIssues() {
  const issues = await client.issues({
    first: 50,
    orderBy: "updatedAt",
  });
  return issues.nodes.map(i => ({
    id: i.id,
    key: i.identifier,         // e.g. ENG-123
    title: i.title,
    state: i.state?.name,
    team: i.team?.key,
    assignee: i.assignee?.name ?? null,
    updatedAt: i.updatedAt,
  }));
}

/** Filter by team + label, with cursor pagination */
export async function listTeamIssues(teamKey: string, labelName?: string) {
  const team = (await client.teams({ filter: { key: { eq: teamKey }}, first: 1 })).nodes[0];
  if (!team) return [];

  let after: string | undefined;
  const out: any[] = [];

  while (true) {
    const page = await client.issues({
      filter: {
        team: { id: { eq: team.id } },
        labels: labelName ? { name: { eq: labelName } } : undefined,
      },
      first: 50,
      after,
      orderBy: "updatedAt",
    });

    out.push(...page.nodes.map(i => ({ key: i.identifier, title: i.title })));
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor!;
  }

  return out;
}