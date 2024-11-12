# Configuration and runtime support

## Story highlights
  - Configuration of the analysis/Kia runtime can be on User or Workspace level

  - Select the runtime to setup and configure, options should support:
    - deployed with the extension itself _(as the default)_
    - portable runtime the developer makes available
    - runtime installed to the workstation (by developer or by admins)

  - Configure the runtime server
    - Standard configuration view pattern is ok
    - Support storing secretes needed by the runtime
      - Support logging in to services (e.g. login to LLM proxy)
      - Support storing already known / manually generated API keys
    - __Concern__: In a large corporate environment, developers are unlikely to have keys to directly access a model or even understand what a model is. A guided login to some kind of llm provider at a known URL is preferred.

  - Verification of configuration covered under the [startup and keep alive](./02-manage_runtime.md) story

  - Use [Walkthroughs](https://code.visualstudio.com/api/ux-guidelines/walkthroughs) as a root for configuration user flows

  - After initial install / start of the extension,open the walkthrough to make it obvious that initial configurations need to be chosen and verified before the extension can operate properly.


## Walkthrough for configuration points

About the UX for the Walkthrough...
  - multi-step checklist featuring rich content
  - when a step is activated, a brief action description with links and action buttons are presented under the step text while a longer image/description is displayed to the right
  - most actions will:
    - open an external URL
    - run a command
    - open a quick pick menu
    - open view, panel or editor

Walkthrough steps:
  1. Guided setup of the Kai runtime (Wizard based?)
    Steps:
      - Select between:
        - runtime included in the extensions
        - external/custom runtime (portable app version and installed versions probably look the same to the extension so no need to differentiate the experience on that)

      - Configure the non-analyzer runtime settings

      - Verify the Kai runtime can be started (this is the "test the runtime starts and a simple ping/ack message is working" action):
        - Startup the server and ping/ack or check/good-to-go
        - Verify/configure any needed external runtimes or libraries
          - Check java
          - Check maven
          - Any other runtimes that would be needed by the supported providers?

  2. [Configure analysis stories - manage analysis configuration profiles](./03-configure_analysis.md#manage):

  3. [Configure analysis stories - select an analysis configuration profile](./03-configure_analysis.md#select)


## Considerations
> [!NOTE]
> All of the active settings will drop in `settings.json` or similar file.  Therefore, all of the settings could be configured under the standard Settings view (Ctrl+,) or directly in the json file.  Profiles or other assets that inform the settings may be stored elsewhere convenient to the extension.

Note:
  - Settings is File>Preferences>Settings (or `Ctrl+,`)
  - Configuration of the runtimes is separate from configuration of the analysis

Assumptions:
  - Configuration will reside in a configuration file on the developer's workstation

Open Questions:
  - How are credentials/keys going to be stored?
  - How is authentication going to be handled?
  - How will the client consume previously solved examples from Konveyor?

