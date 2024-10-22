import "./violations.css";
import React, { useState } from "react";
import {
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  MenuToggleElement,
} from "@patternfly/react-core";
import { EllipsisVIcon } from "@patternfly/react-icons";
import { Violation } from "@editor-extensions/shared";

interface ViolationActionsDropdownProps {
  onGetAllSolutions: (violation) => void;
  violation: Violation;
}

const ViolationActionsDropdown: React.FC<ViolationActionsDropdownProps> = ({
  violation,
  onGetAllSolutions,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => {
    setIsOpen((prevIsOpen) => !prevIsOpen);
  };

  return (
    <Dropdown
      className="violation-actions-dropdown"
      id="violation-actions-dropdown-id"
      isOpen={isOpen}
      onSelect={() => setIsOpen(false)}
      popperProps={{
        appendTo: document.body,
        position: "left",
        direction: "up",
        enableFlip: true,
      }}
      toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={toggleRef}
          onClick={toggleDropdown}
          isExpanded={isOpen}
          aria-label="Violation actions"
          variant="plain"
        >
          <EllipsisVIcon />
        </MenuToggle>
      )}
    >
      <DropdownList>
        <DropdownItem
          key="getSolutions"
          onClick={() => {
            onGetAllSolutions(violation);
            console.log("Get Solutions");
          }}
        >
          Fix all
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
};

export default ViolationActionsDropdown;
