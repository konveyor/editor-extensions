# Catalog of wire frames

Based on the [user stories](../stories/README.md), the set of wire frames needed to implement the stories are listed here.

## TOC

0. [Layout / display areas of the IDE](#wf-0)
1. [Output channel for displaying trace/debug information](#wf-1)
2. [Command palette](#wf-2)
3. [Extension specific welcome page](#wf-3)
4. [Walkthrough with steps](#wf-4)
5. [Guided setup of Kai runtime Wizard](#wf-5)
6. [Manage analysis configuration profiles](#wf-6)
7. [Quick pick menu for analysis configuration profiles](#wf-7)
8. [Quick pick menu for managing the Kai server](#wf-8)
9. [Quick pick menu for an active file](#wf-9)
10. [Global status bar item (for the Workspace) -- for extension/analysis](#wf-10)
11. [Global status bar item (for the Workspace) -- for Kai resolution](#wf-11)
12. [Context status bar item (for the Editor)](#wf-12)
13. [Problems view](#wf-13)
14. [Konveyor AI View Container](#wf-14)
15. [Code editor (for viewing issues and incidents)](#wf-15)
16. [Issue tree view](#wf-16)
17. [Issue view](#wf-17)
18. [Kai resolutions tree view](#wf-18)
19. [Kai resolutions view](#wf-19)
20. [Accept/Reject suggested resolutions](#wf-20)

## Wireframes

0. <a name="wf-0"></a>Layout / display areas of the IDE

   ![ide layout](./00.ide-layout.excalidraw.svg)

1. <a name="wf-1"></a> Output channel for displaying trace/debug information

   - Multiple channels are ok as long it is obvious what each channel will display. There may be technical/debug value in having a channel for:
     - extension processing (settings, start, stop, restart of the server)
     - analyzer processing
     - Kai processing

   ![output channel](./01.outputchannel.excalidraw.svg)

2. <a name="wf-2"></a>Command palette

   - Every entity (command, quick pick menu, and view) that is available in the extension should have a command palette entry to activate/display the entity

   ![command palette](./02.command-palette.excalidraw.svg)

3. <a name="wf-3"></a>Extension specific welcome page, or general Welcome page having Konveyor walkthroughts on the getting started list

   ![welcome page](./03.welcome.excalidraw.svg)

4. <a name="wf-4"></a>Walkthrough with steps:

   - Guided setup of Kai runtime
   - Manage analysis configuration profiles
   - Select active analysis configuration profile

   ![walkthrough steps](./04.walkthrough.get-started.excalidraw.svg)

5. <a name="wf-5"></a>Guided setup of Kai runtime Wizard (editor view) with steps:

   - Select runtime
   - Configure the non-analysis configurations settings
   - Configure credentials/secrets/configurations needed for the LLM
   - Verify the Kai runtime can be started with feedback in the view

   ![runtime wizard](./05.setup-runtime.excalidraw.svg)

6. <a name="wf-6"></a>Manage analysis configuration profiles (editor view)

   - View a list of **packaged** and **user** profiles
   - View the details of a single profile
   - Create a new empty profile
     - A user create profile is where custom rules can be attached
     - **Managing custom rules will need attention**
   - Duplicate an existing profile
   - Remove a user created profile

   ![manage profiles](./06.manage-profiles.excalidraw.svg)

7. <a name="wf-7"></a>Quick pick menu for analysis configuration profiles

   - Pick one of the profiles
   - Open the profile manager

8. <a name="wf-8"></a>Quick pick menu for managing the Kai server

   - Open the _guided setup of Kai runtime_
   - Verify the Kai runtime with feedback as a Notification
   - Restart the server

9. <a name="wf-9"></a>Quick pick menu for an active file

   - Navigate: Goto the first incident in the file
   - Analysis: Reanalyze the file
   - Kai resolution:
     - Resolve all issues in the file with Kai
     - Select and resolve a single issue in the file
     - Select and resolve a singe incident in the file

10. <a name="wf-10"></a>Global status bar item (for the Workspace) -- for extension/analysis

    - If basic setup is incomplete...
      - show as a warning with appropriate text
      - on hover, show a tooltip with basic getting started information
      - on click, launch the _guided setup of Kai runtime_
    - If there is no active profile...
      - show as a warning with appropriate test
      - on hover, show a tooltip
      - on click, launch the _quick pick menu for analysis configuration profiles_
    - If extension and analysis configurations are ok...
      - on initial/long running analysis, show a progress status bar item
      - on short running analysis, bold any results display indicating results may be changing
      - when results are available, show counts of issues and incidents
      - on hover, show a results summary in text
      - on click, open the issues view (or activate the Konveyor View Container)

11. <a name="wf-11"></a>Global status bar item (for the Workspace) -- for Kai resolution

    - Kai is ready
    - Kai is working on a resolution
    - Resolutions are ready for review

12. <a name="wf-12"></a>Context status bar item (for the Editor)

    - if no results apply to the active file, do not display a context status bar item
    - if results apply to the active file, and a short analysis is running, bold the results display (indicating results for the active file may be changing)
    - when results are available, show counts of issues and incidents for the active file
    - on click show a file relevant quick pick menu

13. <a name="wf-13"></a>Problems view

    - Display each known incident as a problem
    - Severity of the problem should be tied to the category/effort of its issue
    - on hover will show the same details as on hover in the editor
    - on left click will open the problem in the file itself (standard behavior)
    - on right click will show the same code actions available in the code editor

    ![problems view](./13.problems-view.excalidraw.svg)

14. <a name="wf-14"></a>Konveyor AI View Container

    - View Container icon
    - Primary Sidebar:
      - Issues tree view
      - Server analyzer / resolution status indicator?
      - Analysis configuration view?
      - Incidents list in an Explorer view? (like the Bookmarks)
    - Panel:
      - Problems view
    - Editor:
      - Issue view

    ![kai view container](./14.kai-view-container.excalidraw.svg)

15. <a name="wf-15"></a>Code editor (for viewing issues and incidents)

    - diagnostics

      - incidents as problems/diagnostics with the underline
      - hover the incident, show the incident's message

    - view problem (Alt+F8)

      - shows the details of a problem/diagnostics expanded on the file

    - code actions

      - "resolve this incident with Kai"
      - "resolve all related incidents with Kai"

    - code lense
      - show meta-data inline with the source code
      - use to embed a webview of the incident/issue's full details?
      - Ctrl+L-click on something in the editor?
      - _Note_: If there are a large number of incident in the file, the number of code lenses could get large and annoying. May need to be able to scope the set of code lenses to a selected issue from the issue/issue tree view. Or at least disable them in extension settings.

16. <a name="wf-16"></a>Issue tree view

    - extension/analyzer not configured, show a [welcome view](https://code.visualstudio.com/api/ux-guidelines/views#welcome-views)
    - if analysis is running, include [progress in the view](https://code.visualstudio.com/api/ux-guidelines/views#views-with-progress)
    - View actions:
      - Rotate active structure
      - Collapse tree
      - Expand tree
    - Structures:
      - "Issues" > Individual issue > File > Incident
      - "Issues" > Individual issue > Incident
      - "Files" > Individual file > Issue > Incident
    - on click of...
      - Issue: open the issue in the issue view
      - File: open the file to the location of the first incident for the enclosing issue
      - Incident: open the file to the location of the incident

    ![issue tree view](./16.issues-tree-view.excalidraw.svg)

17. <a name="wf-17"></a>Issue view (webview)

    - Issue list/table that is filterable and sortable (expandable table | compound expandable | expandable with nested table)
      - Sort on issue name, category, effort, file count, incident count
      - Filter on all issue data
    - Each issue row is expandable to show:
      - Issue details
      - All files/incidents for the issue
        - File shows list of incidents
        - incident just show location (line) and a message
    - Actions to start Kai resolution at different scopes
    - Click to navigate to file/incident

    ![issue view - webview](./17.issues-view-webview.excalidraw.svg)

18. <a name="wf-18"></a>Kai resolutions tree view

    - extension/analyzer not configured, show "No resolutions are available"
    - if analysis is running, include [progress in the view](https://code.visualstudio.com/api/ux-guidelines/views#views-with-progress)
    - View actions:
      - Rotate active structure
      - Collapse tree
      - Expand tree
    - Structures:
      - "Resolution" > File
      - "Resolution" > File > Diff
    - on click of...
      - Resolution: open the resolution in the suggested resolutions view
      - File: open the file to the location of the first diff
      - Diff: open the file to the location to the diff

    ![resolutions tree view](./18.kai-resolutions-tree-view.excalidraw.svg)

19. <a name="wf-19"></a>Kai resolutions view (webview)

    - Potential scopes of resolutions:
      - Single incident
      - All incidents for a single issue in a file
      - All incidents for all issues in a single file
      - All incident for a single issue in all affected files
    - Collect info about the issues/incidents in the scope and show:
      - Details of the scope
      - Progress of the resolution
      - Details/meta-data about the resolution presented
      - List the files changed and the specific diffs
      - Accept (apply all diffs) / Reject (remove all diffs) at the entire resolution level

    ![resolution view](./19.resolution-view.excalidraw.svg)

20. <a name="wf-20"></a>Accept/Reject suggested resolutions

    - Accept/reject a single resolution in a single file
    - Accept/reject all resolutions in a single file
    - Accept/reject all resolutions for a single issue across all files

    ![review changes](./20.review-changes.excalidraw.svg)

# More Details

_(none)_

# Questions

- Q? Can an analysis be running on a different loop than Kai resolutions? This would imply there should be separate status indicators for each side of the tool.
