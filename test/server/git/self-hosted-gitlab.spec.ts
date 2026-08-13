// A self-hosted GitLab, declared in `gitlabHosts` (#1332). Nothing in a URL says whether
// `gitlab.hogefuga.com` is a GitLab, a Gitea or a wiki, so the user says so — and from there it has
// to behave exactly as gitlab.com does, all the way down to the argv `glab` is handed.
import { describe, it, expect, afterEach } from "vitest";
import { forgeFromRepoEntry, forgeOf, projectPath, setDeclaredGitlabHosts } from "../../../server/git/forge-host.js";
import { isSupported, repoForRemote, repoSupport } from "../../../server/git/forge-support.js";
import { glabIssueNotesArgs, glabMrListArgs, glabTarget } from "../../../server/git/glab.js";

const HOST = "gitlab.hogefuga.com";
const ENTRY = `${HOST}/group/project`;

const declare = (...hosts: string[]): void => setDeclaredGitlabHosts(() => hosts);

// The declaration is process-wide (it is read from the live config), so a test that sets it must
// put it back — otherwise the "not declared" cases below pass for the wrong reason.
afterEach(() => setDeclaredGitlabHosts(() => []));

const forgeOfEntry = (entry: string) => {
  const forge = forgeFromRepoEntry(entry);
  if (!forge) throw new Error(`not a repository entry: ${entry}`);
  return forge;
};

describe("a declared host", () => {
  it("is a GitLab, with its own web address", () => {
    declare(HOST);
    expect(forgeOfEntry(ENTRY)).toEqual({ host: HOST, kind: "gitlab", path: "group/project", webUrl: `https://${HOST}/group/project` });
  });

  // GitLab nests groups, and the segment count is the HOST's rule — a declared host inherits
  // GitLab's, not GitHub's two-segment one.
  it("keeps a nested group whole", () => {
    declare(HOST);
    expect(projectPath(forgeOfEntry(`${HOST}/group/sub/project`))).toBe("group/sub/project");
  });

  // The clone on disk reaches this through its remote URL rather than through a config entry, and
  // the name it resolves to is what a `prRepos` entry is matched against.
  it("is recognised from a clone's remote, host-qualified so it matches the entry", () => {
    declare(HOST);
    expect(repoForRemote(`git@${HOST}:group/project.git`)?.repo).toBe(ENTRY);
  });

  it("is listable", () => {
    declare(HOST);
    const support = repoSupport(ENTRY);
    expect(isSupported(support) && support.forge.kind).toBe("gitlab");
  });
});

describe("an undeclared host", () => {
  it("is not a forge this app knows", () => {
    expect(forgeOfEntry(ENTRY).kind).toBe("unknown");
  });

  // The sentence #1332 was filed about. It said the host was unsupported and stopped there, so a
  // user with a working `glab` had no way to tell that one config line was all it needed.
  it("is refused with the config key that would fix it", () => {
    const support = repoSupport(ENTRY);
    expect(isSupported(support)).toBe(false);
    const error = isSupported(support) ? "" : support.error;
    expect(error).toContain(HOST);
    expect(error).toContain("gitlabHosts");
    expect(error).toContain("~/.mulmoterminal/config.json");
  });

  // Declaring GitHub would hand every GitHub repo to `glab`. It is refused at the rule, so no
  // caller has to remember to check.
  it("cannot be created by declaring github.com", () => {
    declare("github.com");
    expect(forgeOfEntry("github.com/acme/web").kind).toBe("github");
  });

  // A remote is a different entrance to the same question, and answering it differently would make
  // a clone and its `prRepos` entry disagree about what they are.
  it("is unknown by remote URL too", () => {
    expect(forgeOf(`https://${HOST}/group/project.git`)?.kind).toBe("unknown");
  });
});

// The half that fails SILENTLY if it is wrong. Measured against glab 1.111.0:
// `--repo gitlab.nonexistent.invalid/group/project` does not name a host — glab asked GITLAB.COM
// for a project called `gitlab.nonexistent.invalid/group/project` and answered 404, while the same
// value as an https URL dialled the host in it. So a self-hosted project addressed the short way
// is not an error the user can see; it is somebody else's server answering.
describe("what glab is told", () => {
  it("names the host in --repo, as a URL", () => {
    declare(HOST);
    expect(glabMrListArgs(glabTarget(forgeOfEntry(ENTRY)), 5)).toContain(`https://${HOST}/group/project`);
  });

  it("never passes the bare host/group/project form, which reaches gitlab.com instead", () => {
    declare(HOST);
    expect(glabMrListArgs(glabTarget(forgeOfEntry(ENTRY)), 5)).not.toContain(ENTRY);
  });

  // `glab api` takes a PATH, so the URL cannot be reused — without `--hostname` it asks gitlab.com,
  // which is the same silent failure one command over.
  it("names the host to `api` with --hostname, and encodes the project as one segment", () => {
    declare(HOST);
    const args = glabIssueNotesArgs(glabTarget(forgeOfEntry(`${HOST}/group/sub/project`)), 7);
    expect(args).toEqual(["api", "--hostname", HOST, "projects/group%2Fsub%2Fproject/issues/7/notes", "--paginate"]);
  });

  // gitlab.com goes down the identical path rather than keeping the old short form: one rule, and
  // no branch that only the majority host walks.
  it("addresses gitlab.com the same way", () => {
    expect(glabTarget(forgeOfEntry("gitlab.com/group/project"))).toEqual({
      host: "gitlab.com",
      project: "group/project",
      repo: "https://gitlab.com/group/project",
    });
  });
});
