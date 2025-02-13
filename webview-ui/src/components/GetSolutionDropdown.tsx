import React, { useState } from "react";
import {
  Dropdown,
  DropdownList,
  DropdownGroup,
  DropdownItem,
  MenuToggle,
  MenuToggleAction,
  Badge,
} from "@patternfly/react-core";
import {
  effortLevels,
  getTruncatedEffortLevel,
  SolutionEffortLevel,
} from "@editor-extensions/shared";
import { EnhancedIncident } from "@editor-extensions/shared";
import { useExtensionState } from "../hooks/useExtensionState";
import { getSolution } from "../hooks/actions";
import { WrenchIcon, EllipsisVIcon } from "@patternfly/react-icons";

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

  const badgeText =
    incidents.length > 1 ? `${incidents.length} incidents` : `${incidents.length} incident`;

  const menuToggle =
    scope === "workspace" || scope === "issue" ? (
      <MenuToggle
        variant="primary"
        isDisabled={
          isFetchingSolution ||
          isAnalyzing ||
          isStartingServer ||
          isInitializingServer ||
          state.serverState !== "running"
        }
        splitButtonOptions={{
          items: [
            <MenuToggleAction
              id="split-button-action-primary-example-with-toggle-button"
              key="split-action-primary"
              onClick={() => onGetSolution(incidents, state.solutionEffort)}
              aria-label="Get solution"
            >
              <WrenchIcon />
              {"  "} Resolve {incidents.length} {incidents.length > 1 ? "incidents" : "incident"}
            </MenuToggleAction>,
          ],
          variant: "action",
        }}
        onClick={() => setIsOpen(!isOpen)}
        isExpanded={isOpen}
        aria-label="Effort Levels"
      />
    ) : (
      <MenuToggle
        aria-label="kebab dropdown toggle"
        isDisabled={
          isFetchingSolution ||
          isAnalyzing ||
          isStartingServer ||
          isInitializingServer ||
          state.serverState !== "running"
        }
        variant="plain"
        onClick={() => setIsOpen(!isOpen)}
        isExpanded={isOpen}
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
      }}
      ouiaId="EffortDropdown"
    >
      <DropdownList>
        <DropdownGroup
          label={
            scope === "workspace" || scope === "issue"
              ? "Make request for solution with alternate effort"
              : `Get solution for ${incidents.length} ${incidents.length > 1 ? "incidents" : "incident"}`
          }
          labelHeadingLevel="h3"
        >
          {Object.entries(effortLevels).map(([label]) => (
            <DropdownItem
              key={label}
              isDisabled={
                scope === "workspace" || scope === "issue" ? label === state.solutionEffort : false
              }
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
