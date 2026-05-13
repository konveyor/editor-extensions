# Startup and keep alive the analyzer/Kai runtime

The plugin is responsible for managing the runtime (start, stop, restart) and for reporting its status.


## Story highlights
  - After initial install / start of the extension, decide what needs to be done:
    - attempt to start the embedded servers with default configs, OR
    - open the [configuration view](./01-configuration_and_runtime_support.md) to force user interaction to verify configuration

  - Configuration view should have a 'Test' button to:
    - verify the configuration is valid (according to some static criteria / schema validation),
    - verify the agent server can be started,
    - verify the server can receive initialization configuration and the response is a positive ack

  - Status indication on vscode's status bar
    - Show "status bar item" for the whole workspace
      - When an action is running, have a visual indicator (spinner)
      - Hovering the status shows brief information
      - Clicking the status indicator ...
        - Open relevant command palette?
        - Open configuration view?

    - Show "status bar item" for an open file
      - When changes for a file are being processed, have a visual indicator
      - Hovering the status shows a count of issues in the file
      - Clicking the status indicator ...
        - Open relevant command palette?
        - Open configuration view?

  - Provide logs to a selectable Output view
    - one log for any server being managed by the plugin
    - any other trace logging that could be useful

  - Command Palette
    - Open configuration view
    - Restart server (for each server that is manageable)


## Considerations
...
