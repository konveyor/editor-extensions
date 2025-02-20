import React, { useState, useEffect } from "react";
import {
  Dropdown,
  DropdownList,
  DropdownGroup,
  DropdownItem,
  MenuToggle,
  MenuToggleAction,
  Badge,
} from "@patternfly/react-core";
import { effortLevels, SolutionEffortLevel } from "@editor-extensions/shared";
import { EnhancedIncident } from "@editor-extensions/shared";
import { useExtensionState } from "../hooks/useExtensionState";
import { getSolution } from "../hooks/actions";
import { EllipsisVIcon, WrenchIcon } from "@patternfly/react-icons";

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
  const [state, dispatch] = useExtensionState();
  const { isFetchingSolution, isAnalyzing, isStartingServer, isInitializingServer } = state;
  const onGetSolution = (incidents: EnhancedIncident[], effort: SolutionEffortLevel) => {
    dispatch(getSolution(incidents, effort));
  };

  // State to track button disabled status
  const [isButtonDisabled, setIsButtonDisabled] = useState(true);

  useEffect(() => {
    setIsButtonDisabled(
      isFetchingSolution || isAnalyzing || isStartingServer || isInitializingServer,
    );
  }, [isFetchingSolution, isAnalyzing, isStartingServer, isInitializingServer]);

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
              description={
                label === state.solutionEffort ? "currently configured effort level" : ""
              }
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
