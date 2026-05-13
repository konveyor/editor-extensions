# Summary statement

The Kai ide experience focuses on the common habits of a developer who needs to migrate a project to a new technology.

Analysis provides issues. Issues contain incidents. All of the incidents in all of the issues need to be resolved in order to migrate to a new technology. The tooling should encourage the developer to focus on making changes at the issue level. Scoping work to a single issue can help to keep both the set of changes needed at any one time smaller, and developer cognitive load low.

From an identified set of issues, the developer will commonly want to:

1. Fix a single issue in a single source file
2. Fix a single issue across all affected files
3. Fix all issues in a single source file
4. Fix all issues across all files

Fixing a single issue in a single source file is the common linter/codemod pattern. A problem is highlighted in the editor. Activating the code actions at that point displays more information about the issue and allows requesting a codemod to fix the issue.

Fixing a single issue across all affected files is a broader operation. This is the current target of the Kai ide experience.

# User Experience - Stories and Wireframes

View the [catalog of high-level user stories](./stories/README.md).

The wireframes that handle the user story interactions are [in the wireframes catalog](./wireframes/README.md).

# Basic information

There will exist:

- An ide plugin
- A static code analyzer
- A Kai instance (generative AI codemod agent) for fixing issues

Questions to keep in mind:

- What would a cynical developer think?
- What is part of the tech preview happy path deliverable?
- How is this different from using a standard linter/codemod process? (eslint, prettier)

Some wider technical assumption:

- Plugin and the Analyzer/Kai are all individual components
  - The analyzer functionality may be provided by the Kai instance or it may be separate. As long as the the distinct functionality of those two entities exist, the implementation specific can vary.
- Analyzer and Kai are orchestrated into a cohesive user experience by the plugin
- Assume a corporate environment with no admin rights and limited permissions. A few possible runtime permutations to consider:
  - Local portable apps from the plugin dist
  - Local portable apps from the user located outside the plugin dist
  - Local apps installed for the user (e.g. CSB package, headless windows install)
  - Remote apps running somewhere (e.g. Konveyor hub server)

Interaction assumptions:

- Analysis forward (focus on identifying the issues to guide where to have Kai make fixes)
- When waiting for an action to complete (analysis or codemod), a visual indication of “action in progress” / “working” should be displayed

## Future considerations

The scope of any Kai suggested change will include anything that needs to change to completely fix the problem. This includes any changes or refactoring that may need to happen in other files, or even the creation of new files. Depending on the actual structure of the suggested changes, some stories and wireframes may need to be adjusted.
