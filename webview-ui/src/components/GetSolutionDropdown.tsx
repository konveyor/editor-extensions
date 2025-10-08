import React, { useState } from "react";
import {
  Dropdown,
  DropdownList,
  DropdownGroup,
  DropdownItem,
  MenuToggle,
  MenuToggleAction,
  Tooltip,
} from "@patternfly/react-core";
import { EnhancedIncident } from "@editor-extensions/shared";
import { useExtensionStateContext } from "../context/ExtensionStateContext";
import { getSolution, getSolutionWithKonveyorContext } from "../hooks/actions";
import { EllipsisVIcon, WrenchIcon } from "@patternfly/react-icons";
import { getBrandName } from "../utils/branding";

type GetSolutionDropdownProps = {
  incidents: EnhancedIncident[];
  scope: "workspace" | "issue" | "in-between" | "incident";
};

const GetSolutionDropdown: React.FC<GetSolutionDropdownProps> = ({ incidents, scope }) => {
  if (!incidents || incidents.length === 0) {
    console.log("Empty Incidents");
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const { state, dispatch } = useExtensionStateContext();
  const onGetSolution = (incidents: EnhancedIncident[]) => {
    dispatch(getSolution(incidents));
  };

  const onGetSolutionWithKonveyorContext = (incident: EnhancedIncident) => {
    dispatch(getSolutionWithKonveyorContext(incident));
  };

  // Hide component completely when GenAI is disabled
  if (state.configErrors.some((e) => e.type === "genai-disabled")) {
    return null;
  }

  const isButtonDisabled =
    state.isFetchingSolution || state.isAnalyzing || state.serverState !== "running";

  const dropdown = (
    <Dropdown
      isOpen={isOpen}
      onSelect={() => setIsOpen(false)}
      onOpenChange={(isOpen: boolean) => setIsOpen(isOpen)}
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          variant="plain"
          isDisabled={isButtonDisabled}
          splitButtonItems={[
            <Tooltip
              key="split-action-primary-tooltip"
              content="Always review AI generated content prior to use."
            >
              <MenuToggleAction
                id="get-solution-button"
                key="split-action-primary"
                onClick={() => onGetSolution(incidents)}
                aria-label="Get solution"
                data-scope={scope}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <WrenchIcon />
                  <span style={{ fontSize: "0.875rem", color: "#6a6e73" }}>AI</span>
                </div>
              </MenuToggleAction>
            </Tooltip>,
          ]}
          onClick={() => setIsOpen(!isOpen)}
          isExpanded={isOpen}
          aria-label="Effort Levels"
          icon={<EllipsisVIcon />}
        />
      )}
      popperProps={{
        appendTo: document.body,
        position: "right",
        enableFlip: true,
        preventOverflow: true,
      }}
      ouiaId="EffortDropdown"
    >
      <DropdownList>
        <DropdownGroup
          label={`Get solution for ${incidents.length} ${incidents.length > 1 ? "incidents" : "incident"}`}
          labelHeadingLevel="h3"
        >
          <DropdownItem key="get-rag-solution" onClick={() => onGetSolution(incidents)}>
            Get solution
          </DropdownItem>
          {scope === "incident" && incidents.length === 1 && state.isContinueInstalled && (
            <DropdownItem
              key="ask-continue-konveyor"
              onClick={() => onGetSolutionWithKonveyorContext(incidents[0])}
            >
              Ask Continue with {getBrandName()} Context
            </DropdownItem>
          )}
        </DropdownGroup>
      </DropdownList>
    </Dropdown>
  );

  return dropdown;
};

export default GetSolutionDropdown;
