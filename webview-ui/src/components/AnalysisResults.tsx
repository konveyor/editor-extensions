import React from "react";

interface AnalysisResultsProps {
  results: string[];
}

const AnalysisResults: React.FC<AnalysisResultsProps> = ({ results }) => {
  return (
    <div className="mt-8">
      <h2 className="text-2xl font-semibold mb-4">Analysis Results</h2>
      {results.length === 0 ? (
        <p className="text-gray-500">No results yet. Start the analysis to see results.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((result, index) => (
            <li key={index} className="bg-white p-4 rounded-md shadow">
              {result}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AnalysisResults;
