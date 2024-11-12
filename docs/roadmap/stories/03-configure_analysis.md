# Configure Analysis

A developer will need to choose the options to apply for analysis of their project.  They need to consider where they are coming from and where they are going.  Selection of an appropriate analysis configuration for a project is very important for the accurate and useful discovery and resolution of issues.

The plugin will provide an analysis configuration to the analyzer/Kai server.  The analysis configuration may be changed at any time by the developer and the analyzer/Kai server will need to readjust.

Konveyor web UI provides a robust guided build of an analysis task.  Much of the configuration help is not available when using the current kantra CLI.  The plugin needs to include guided selection of analysis configurations.


## Story Highlights
  - Analysis configuration should be __profile__ based...
    - A profile is defined as a bundle of analyzer options...
      - source tech,
      - target tech,
      - rule labels,
      - custom rules
    - Follow a similar pattern to the way run/debug configurations are stored
    - Anticipate a single configuration file with multiple entires

  - Only a single profile will be active at any given time

  - The developer may change the active profile at any time

  - The developer may define their own analysis configuration profiles

  - Provide a set of preset analysis configurations[^1]
    - presets would be based on what is packaged with the extension
    - presets would be provided for the common migration targets (e.g. JEE to Quarkus, or Spring Framework to Spring Boot)

  - Status indication in vscode's status bar (in addition to its runtime management function) should
    - Indicate the active analysis configuration profile at a glance (can be similar to how git shows the current branch)
    - Hovering the static indicator shows the full name of the analysis configuration profile
    - Clicking the status indication...
      - Open relevant command palette to allow opening the configuration options, managing the runtime, asking for a full analysis, or any other similar commands

  - Command Palette
    - Select analysis configuration
    - Create/Edit analysis configurations

  - After initial install / start of the extensions, an analysis configuration must be selected before any issues can be discovered and presented
    - Status indicator should show "Configuration required" as necessary
    - Custom views should show "Configuration required" as necessary


## Walkthrough for configuration points

The [extension and runtime configuration walkthrough](./01-configuration_and_runtime_support.md#walkthrough-for-configuration-points) call for a number of steps for full configuration of the extension, the runtime, and the analyzer.  Managing the configuration analysis profiles, and selecting the analysis configuration profile are part of the stories here.

  1. <a href="manage"></a>Manage analysis configuration profiles as a custom webview in the editor space
      - View a list packaged profiles
      - View the details of a single profile
      - Create a new empty profile
        - (details of the fields and what is required depends on the Kai-server)
      - Duplicate an existing profile
      - Remove a user created profile
        - (new empty or duplicated profiles only -- keep packaged profiles around)

  2. <a href="select"></a>Select an analysis configuration profile
      - Pick one from a quick pick menu
      - Open the profile manager
      - Note: This action may be invoked from many other places


## Considerations
> [!NOTE]
> All of the settings will drop in `settings.json` or similar file.  Therefore, all of the settings could also be configured under the standard Settings view (Ctrl+,) or directly in the json file.

...

[^1]: Comparing to Konveyor HUB and UI, we can emulate the [hub target entities](https://github.com/konveyor/tackle2-hub/blob/6b050e7be9e651f12e9c64b2b685a856f8e1e970/api/target.go#L237-L247) and provide an experience similar to what is asked for in the [target platforms](https://github.com/konveyor/enhancements/tree/master/enhancements/archetype-target-platforms) enhancement.

