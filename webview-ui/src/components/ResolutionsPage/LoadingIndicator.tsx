import React from "react";
import "./loadingIndicator.css";

const LoadingIndicator: React.FC = () => {
  return (
    <div className="loading-indicator" style={{ display: "inline-block", marginLeft: "10px" }}>
      <span className="dot dot1">.</span>
      <span className="dot dot2">.</span>
      <span className="dot dot3">.</span>
    </div>
  );
};

export default LoadingIndicator;
