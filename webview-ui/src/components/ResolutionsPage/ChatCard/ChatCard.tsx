import { Card, CardBody } from "@patternfly/react-core";
import React, { FC } from "react";

export const ChatCard: FC<{ color: "blue" | "yellow"; children: JSX.Element }> = ({
  children,
  color,
}) => (
  <Card className={`chat-bubble pf-m-${color}`}>
    <CardBody>{children}</CardBody>
  </Card>
);
