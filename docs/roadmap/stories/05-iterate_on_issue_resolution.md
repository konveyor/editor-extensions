# Iterate on issue resolution

Once a developer has selected an issue or a single incident to work on, they'll ask Kai for changes.  The resulting code changes are presented back to the developer with any annotations available.  The developer will review the suggested changes and either approve, or deny the change.  Which choice is made for each suggestion may be relayed back to Kai for future use.

Iterating over Kai proposed solution in a conversational interaction is a future goal.

## Story Highlights

  - In order of increasing scope, a developer may start working with __Kai resolutions__ from:
    - file level, single issue, single incident: a single incident in a file for a single issue
    - file level, single issue, all incidents: all incidents within a single file for a single issue
    - file level, all issues, all incidents: all incidents within a single file
    - issue level: single issue's effected files and incidents across those files
    - project level: the full set of issues across the project
    - __NOTE__: Depending on the capabilities available from the Kai server at the time of any given release, some of the scopes may not be available for selection.

  - A typical developer workflow is anticipated to be:
    - request a __Kai resolution__ at a particular scope
    - review the resulting __changes__
    - accept/reject each change
    - view analysis results after the changes are accepted/rejected
    - commit the changes to source control

  - In general, the resolution scope to focus on will be a balance between the size of __changes__ that Kai can work on and what is easy for the developer to consider at one time.  We want to avoid developer cognitive overload by selecting scopes where the suggested changes can be reasonably verified.

### Starting a resolution
  - In a file editor, provide [Code Actions](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#possible-actions-on-errors-or-warnings) (Ctrl+.) on an incident warning to start __Kai resolution__.  Multiple actions can be provided, and the text for each action can align to the resolution scope.  Core set of actions can be:
    - within the file, resolve just the focused incident &rarr; "resolve this incident with Kai"
    - within the file, resolve all incidents for the same issue that owns the focused incident &rarr; "resolve all related incidents with Kai"
    - _Note_: other code actions to link to incident/issue details may also be present but should be in a separate grouping.  Other informational actions would be defined in [surface analysis](./04-surface_analysis.md).

  - In the Problems panel, provide Code Actions (RightClick) for the incidents.  Core set of actions can be:
    - resolve just the focused incident &rarr; "resolve this incident with Kai"
    - within the incident's file, resolve all incidents for the same issue that owns the focused incident &rarr; "resolve all relates incidents with Kai"

  - In the Issues Tree view...
    - For a file nested under an issue - Context menu clicks, or action icons, should include actions to resolve all of the parent's incidents found in the selected file
    - _future goal x2_: For a base issue - Context menu clicks, or action icons, should include actions to resolve the issue across all affected files
    - _future goal x3_: View actions, at the top level, should include an action to resolve all issues found in the project

  - In the Issues view...
    - For a file nested under an issue - Context menu clicks, or action icons, should include actions to resolve all of the parent's incidents found in the selected file
    - If individual incidents per file are shown in the issues view, actions to resolve a single incident should be available
    - _future goal x2_: For a base issue - Context menu clicks, or action icons, should include actions to resolve the issue across all affected files
    - _future goal x3_: View actions, at the top level, should include an action to resolve all issues found in the project

  - Status indicator for an open editor...
    - When activating the quick pick menu, the actions should include the ability to:
      - select a single incident in the file to resolve
      - select a single issue in the file and resolve all of the related incidents in that file

  - Similar general command pallette actions could also be made available, reusing quick pick menu actions

### Reviewing and applying a resolution

  - After receiving a resolution from Kai, the developer needs to be shown the change along with any annotation or meta data available.  Developers should be able to decide how much annotation/meta-data details they see by default as a extension settings item.  Could be "full", "headlines", "none".

  - Consider using generated code comments from the resolution as a way to display the annotations.  This feels similar to the way a GitHub code review comment is handled.

  - These items will change over time.  It is expected that the current wireframes for the "Konveyor Resolutions" view will be a more complete functional set than what is cataloged here. The challenge questions for the review, accept, reject stories are:

    - What to do when waiting for a response?

    - What kind of annotations for a suggested resolution will be available to show to the developer to help them understand the resolution?

    - Can there be a confidence factor associated to the resolution?

    - How do diff/resolution views look and function for:
      - a single file, single incident change?
      - for a single file, multiple incident change?
      - for a singe issue, multiple file, multiple incident change?

    - How to accept all or part of the resolution?

    - How to reject all or part of the resolution?

  - __Note__: Iterating on the resolution by interacting with the Kai server is future work.  The kind of useful feedback the developer can provide to Kai to iterate on a suggested resolution still needed to be determined both in user story and in technical capabilities.


## Considerations

Since Kai is working with the goal of "completely fixing the problem", multiple files may receive changes when fixing a single incident. This may be a long running request. With the extra thinking time, and a set of the changes with some explanation details lines up with a standard pull request kind of process.  Put potential changes somewhere and ask a developer to merge them after reviewing the description and code changes.

Basics...
  - at minimum: interact with Kai on a single issue in a single source file
  - _stretch goal_: interact with Kai on the basis of a single issue that may span multiple source files
  - _future goal_: interact with Kai on the basis of all issues in a single file
  - _future goal x2_: interact with Kai on the basis of a single issue across all sources
  - _future goal x3_: full project changes

vscode has a `MultiDiffEditor` used by source control to view all changes in a commit.
  - See the view by selecting a commit in the "Source Control Graph" on the Source Control view
  - https://code.visualstudio.com/updates/v1_86#_review-multiple-files-in-diff-editor
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/multiDiffEditor/browser/multiDiffEditor.ts
  - __Note__: This component is not currently available to "normal" extensions.  Maybe in the future, it will be generally available.

Comments view...

Consider __local workspace extensions__ as a way to provide the Kai extension to a project while it is in migration.  All of the configurations and Kai runtimes appropriate could be packed in the repo and auto applied.  More information:
  - https://code.visualstudio.com/updates/v1_89#_local-workspace-extensions
  - .vscode/extensions/__name__ ---> unpacked extension, not the VSIX file
  - "You can now include an extension directly in your workspace and install it only for that workspace. This feature is designed to cater to your specific workspace needs and provide a more tailored development experience."

GitHub copilot plugin...
  - Like continue, there are extension point to plug in functionality to their chat flow
  - Parts of Konveyor / Kai could be plugged in for extra features across their flow
  - Interesting to consider their "compact inline chat"

What happens if a resolution requires cascading code refactors (i.e. a function/method signature changes)?  It may be difficult to identify these kinds of changes.

-----

- "Allow the cynical developer to have a manual drive first to get a feel of the quality of what's being returned and then move to the automated experience."

- Feedback loop is very limited in the prototype:
  - Users can only accept or reject a fix, there’s no way for the user to provide additional context to get a more suitable solution.
  - Being able to tweak the automatically generated prompt has been suggested.

- Using diffs might be effective at scale, but feels like a poor/outdated user experience when compared to interactive code assistants

- How to surface cascading changes across multiple files?  Part of this answer is the Kai server should "fix the problem following the solution across whatever file changes are needed".  Allowing meta-data display from the solution results along side the set of changes should cover this challenge.
