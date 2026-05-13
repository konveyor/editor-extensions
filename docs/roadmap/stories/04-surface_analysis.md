# Surface analysis results

When the analyzer is configured and running, it will return analysis results.  These results will be transformed into data useful for the standard vscode flows and for any custom views.

## Story Highlights

  - Two presentations of the results are possible:
    - Display incidents as standard file level lint errors (file diagnostics)
    - Display the set of issues with the affected files grouped under the issue

  - Other language servers and linters will only add problems to the list when a file is opened.  This can make it difficult to find all of the problems without resorting to running a linting tool outside of vscode and linking all the errors back.  With a project level analyzer running, the full incident->problem list can be populated right at the beginning.  As files are opened, changed, and saved, the analyzer can update the results and the problems can be adjusted to the current state of the source file.

  - Standard file level lint error style just requires knowledge of the file, line, and column coordinates

  - For a single incident...
    - it shows up in the Problems view
    - severity (info, warning, error) is defined from the incident's issue's category

  - In a file editor...
    - at a glance, only incidents will be visible
    - a single incident shows up as code problem/hint/underline
      - when code problem is hovered, at least the incident's message is shown
      - when code problem view is open, at least the incident's message is show
      - provide a link inside the code problem view to open the incident details
      - provide a link in the code action menu (Ctrl+.) to open the incident or issue details
      - see: [diagnostic sample](https://github.com/microsoft/vscode-extension-samples/tree/main/diagnostic-related-information-sample)
    - potential to use a [code lense](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#codelens-show-actionable-context-information-within-source-code) / [code lense sample](https://github.com/microsoft/vscode-extension-samples/tree/main/codelens-sample) to highlight where an incident is located with the basic info and action buttons presented (corollary is a git extension that can highlight the beginning of a change in the last commit)
    - provide some extension level configuration for:
      - the underline display styling
      - the scroll bar indicator block
      - code lense information

  - Status indicator for the workspace...
    - Count of issues (perhaps even by issue category) and incidents should be shown independently from the problem count status indicator
    - Hover over the counts show the same details but with words
    - Click on the counts opens the issues tree view, or panel, or full editor view

  - Status indicator for an open editor....
    - Count of issues and incidents for the open editor can be shown
    - Hover over the counts show the same details but with words
    - Click on the counts opens a quick pick menu that would have Kai actions relevant to the entire file.  Could be something like:
      - Goto first incident
      - Reanalyze file
      - Ask Kai to fix all incidents in this file

  - A Konveyor AI [View Container](https://code.visualstudio.com/api/ux-guidelines/views#view-containers) can setup the primary sidebar with analyzer and issue focused views

  - [Tree View](https://code.visualstudio.com/api/ux-guidelines/views#tree-views) for issues...
    - Tree view where data is listed by: Issue > File > Incident
    - Each __issue__ is a root item on the tree
    - Each issue item can be expanded to view the __files__ containing the incidents
    - Each file item expands to all of the __incidents__ in the file for that issue

  - Issue view...
    - Could be a webview in the Editor area
    - Could be a table like view in the Panel area
    - Provide an issue list that is filterable and sortable
    - Like the basic tree view, opening an issue can show the linked files and incident
    - Unlike the basic tree view, opening an issue can show the description text and any other detailed information about the issue, including but not limited to incident count, files affected count, category/severity, effort score all above the nested table listing the file/incident details
    - Note: This can be similar content to the `Issues` view of the Konveyor web UI
    - Allow toggling details on and off (off would show details in a hover/popover)
    - Clicking on a file in the issue view will open the file in the editor and navigate to the first known incident in the file
    - Clicking on an incident will open the file in the editor and navigate to the selected incident in the file
    - Actions should be allowed to:
      - Ask Kai to fix an issue across all linked incidents
      - Allow developer ranking of issue (a custom sort order)

  - With the analysis forward approach, we will want to emphasize the issues over the incidents


## Considerations

Analysis produces a set of issues.  The results can be streaming or a single document with results for the entire project.

Two branches for interaction with incidents:
  - as file based problems in the normal linter/codemod pattern
  - as issues at the project level potentially spanning multiple files

Each issue contains data including:
  - __ruleset__ containing the rule triggered
  - __rule__ id of the rule triggered
  - __name__
  - __description__
  - __category__ (mandatory, potential, ...)
  - __effort__ (as an integer)
  - __labels__ of the rule triggered
  - __links__ set of URLs to reference for the issue
  - __incidents__ one for each incident - if file contains multiple incidents for the rule, each incident will be listed separately with the file name repeated

Each incident contains data including:
  - __file__ the is affected
  - __line__ of the incident in the file
  - __message__ markdown formatted message to describe the incident
  - __codeSnip__ code snippet of the incident extracted by the analyzer
  - __facts__

