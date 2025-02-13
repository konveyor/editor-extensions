import React, { useState } from "react";
import {
  Dropdown,
  DropdownList,
  DropdownGroup,
  DropdownItem,
  MenuToggle,
  MenuToggleAction,
} from "@patternfly/react-core";
import { effortLevels, SolutionEffortLevel } from "@editor-extensions/shared";
import { EnhancedIncident } from "@editor-extensions/shared";
import { useExtensionStateContext } from "../context/ExtensionStateContext";
import { getSolution } from "../hooks/actions";
import { EllipsisVIcon, WrenchIcon } from "@patternfly/react-icons";

type GetSolutionDropdownProps = {
  incidents: EnhancedIncident[];
  scope: "workspace" | "issue" | "in-between" | "incident";
};

const GetSolutionDropdown: React.FC<GetSolutionDropdownProps> = ({ incidents }) => {
  if (!incidents || incidents.length === 0) {
    console.log("Empty Incidents");
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const { state, dispatch } = useExtensionStateContext();
  const onGetSolution = (incidents: EnhancedIncident[], effort: SolutionEffortLevel) => {
    dispatch(getSolution(incidents, effort));
  };

  const isButtonDisabled =
    state.isFetchingSolution || state.isAnalyzing || state.serverState !== "running";

  const menuToggle = (
    <MenuToggle
      variant="primary"
      size="sm"
      isDisabled={isButtonDisabled}
      splitButtonOptions={{
        items: [
          <MenuToggleAction
            id="get-solution-button"
            key="split-action-primary"
            onClick={() => onGetSolution(incidents, state.solutionEffort)}
            aria-label="Get solution"
          >
            <WrenchIcon />
          </MenuToggleAction>,
        ],
      }}
      onClick={() => setIsOpen(!isOpen)}
      isExpanded={isOpen}
      aria-label="Effort Levels"
      icon={<EllipsisVIcon />}
    />
  );

  return (
    <Dropdown
      isOpen={isOpen}
      onSelect={() => setIsOpen(false)}
      onOpenChange={(isOpen: boolean) => setIsOpen(isOpen)}
      toggle={(toggleRef) => React.cloneElement(menuToggle, { ref: toggleRef })}
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
          {Object.entries(effortLevels).map(([label]) => (
            <DropdownItem
              key={label}
              description={label === state.solutionEffort && "currently configured effort level"}
              onClick={() => onGetSolution(incidents, label as SolutionEffortLevel)}
            >
              Resolve with {label} effort
            </DropdownItem>
          ))}
        </DropdownGroup>
      </DropdownList>
    </Dropdown>
  );
};

export default GetSolutionDropdown;
