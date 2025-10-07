import React, { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectOption,
  SelectOptionProps,
  SelectList,
  MenuToggle,
  MenuToggleElement,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
  Label,
  LabelGroup,
  Button,
} from "@patternfly/react-core";
import { TimesIcon } from "@patternfly/react-icons";

interface CreatableMultiSelectFieldProps {
  value: string[];
  onChange: (newValues: string[]) => void;
  initialOptions: string[];
  placeholder?: string;
  fieldId: string;
  isDisabled?: boolean;
}

export const CreatableMultiSelectField: React.FC<CreatableMultiSelectFieldProps> = ({
  value,
  onChange,
  initialOptions,
  placeholder = "Select or create item",
  fieldId,
  isDisabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [options, setOptions] = useState<SelectOptionProps[]>(
    initialOptions.map((opt) => ({ value: opt, children: opt })),
  );
  const [filtered, setFiltered] = useState<SelectOptionProps[]>(options);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const textInputRef = useRef<HTMLInputElement>(undefined);

  const CREATE = "create";

  useEffect(() => {
    const normalizedInput = inputValue.toLowerCase();

    const filteredOptions = options
      .filter((opt) => String(opt.children).toLowerCase().includes(normalizedInput))
      .sort((a, b) => String(a.children).localeCompare(String(b.children)));

    const isAlreadyIncluded = options.some(
      (opt) => String(opt.value).toLowerCase() === normalizedInput,
    );

    if (inputValue && !isAlreadyIncluded) {
      filteredOptions.push({
        value: CREATE,
        children: `Create new option "${inputValue}"`,
      });
    }

    setFiltered(filteredOptions);
  }, [inputValue, options]);

  const itemId = (val: string) => `${fieldId}-option-${val.replace(/\s+/g, "-")}`;

  const setFocus = (index: number) => {
    setFocusedIndex(index);
    setActiveItemId(itemId(filtered[index].value as string));
  };

  const resetFocus = () => {
    setFocusedIndex(null);
    setActiveItemId(null);
  };

  const handleSelect = (selectedVal: string) => {
    if (selectedVal === CREATE) {
      if (!options.some((opt) => opt.value === inputValue)) {
        const newOpt = { value: inputValue, children: inputValue };
        setOptions((prev) => [...prev, newOpt]);
      }
      const updated = value.includes(inputValue)
        ? value.filter((v) => v !== inputValue)
        : [...value, inputValue];
      onChange(updated);
      setInputValue("");
    } else {
      const updated = value.includes(selectedVal)
        ? value.filter((v) => v !== selectedVal)
        : [...value, selectedVal];
      onChange(updated);
      setInputValue("");
    }

    textInputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!filtered.length) {
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next =
        focusedIndex === null || focusedIndex === filtered.length - 1 ? 0 : focusedIndex + 1;
      setFocus(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev =
        focusedIndex === null || focusedIndex === 0 ? filtered.length - 1 : focusedIndex - 1;
      setFocus(prev);
    } else if (e.key === "Enter") {
      if (isOpen) {
        e.preventDefault();
        if (focusedIndex !== null) {
          handleSelect(filtered[focusedIndex].value as string);
        }
      }
      if (!isOpen) {
        setIsOpen(true);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      resetFocus();
    }
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      variant="typeahead"
      onClick={() => setIsOpen(!isOpen)}
      innerRef={toggleRef}
      isExpanded={isOpen}
      isFullWidth
      isDisabled={isDisabled}
    >
      <TextInputGroup isPlain>
        <TextInputGroupMain
          value={inputValue}
          onChange={(_e, val) => {
            setInputValue(val);
            resetFocus();
          }}
          onClick={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          innerRef={textInputRef}
          placeholder={placeholder}
          aria-activedescendant={activeItemId ?? undefined}
          role="combobox"
          isExpanded={isOpen}
          aria-controls={`${fieldId}-listbox`}
          //   onClick={onInputClick}
          //   onChange={onTextInputChange}
          //   onKeyDown={onInputKeyDown}
          id="multi-create-typeahead-select-input"
          autoComplete="off"
          {...(activeItemId && { "aria-activedescendant": activeItemId })}
        >
          <LabelGroup>
            {value.map((val) => (
              <Label
                key={val}
                onClose={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v !== val));
                }}
                variant="outline"
              >
                {val}
              </Label>
            ))}
          </LabelGroup>
        </TextInputGroupMain>
        <TextInputGroupUtilities>
          {value.length > 0 && (
            <Button
              variant="plain"
              onClick={() => onChange([])}
              aria-label="Clear selections"
              icon={<TimesIcon />}
            />
          )}
        </TextInputGroupUtilities>
      </TextInputGroup>
    </MenuToggle>
  );

  return (
    <Select
      id={`${fieldId}-select`}
      toggle={toggle}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      selected={value}
      onSelect={(_, val) => handleSelect(val as string)}
      variant="typeahead"
    >
      <SelectList
        isAriaMultiselectable
        id={`${fieldId}-listbox`}
        role="listbox"
        style={{ maxHeight: "200px", overflowY: "auto" }}
      >
        {filtered.map((opt, idx) => (
          <SelectOption
            key={opt.value ?? opt.children}
            id={itemId(opt.value as string)}
            isFocused={idx === focusedIndex}
            onMouseDown={(e) => e.preventDefault()} // stop blur
            {...opt}
            ref={null}
          />
        ))}
      </SelectList>
    </Select>
  );
};
