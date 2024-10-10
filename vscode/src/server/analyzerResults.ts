import * as vscode from 'vscode';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {Violation, RuleSet, Category  } from './ruleset';

//Assuming that output is in form of yaml
function readYamlFile(filePath: string): RuleSet[] | undefined {
    try {
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const data = yaml.load(fileContents);
        if (Array.isArray(data)) {
            return data as RuleSet[];
        } else {
            console.error('YAML content is not an array of rulesets');
            return undefined;
        }
    } catch (e) {
        console.error('Error reading YAML file:', e);
        return undefined;
    }
}

function getSeverityFromCategory(category: Category | undefined): vscode.DiagnosticSeverity {
    switch (category) {
        case Category.Mandatory:
            return vscode.DiagnosticSeverity.Error;
        case Category.Optional:
            return vscode.DiagnosticSeverity.Warning;
        case Category.Potential:
            return vscode.DiagnosticSeverity.Hint;
        default:
            return vscode.DiagnosticSeverity.Information; 
    }
}

let diagnosticList: vscode.Diagnostic[] = [];
function processIncidents(ruleSets: RuleSet[], diagnosticCollection: vscode.DiagnosticCollection): vscode.DiagnosticCollection {
    diagnosticCollection.clear();
    diagnosticList = [];

    ruleSets.forEach((ruleSet) => {
        for (const violationId in ruleSet.violations) {
            const violation = ruleSet.violations[violationId];
            const severity = getSeverityFromCategory(violation.category);
            violation.incidents.forEach((incident) => {
                if (incident.uri) { 
                    const uri = vscode.Uri.parse(incident.uri);
                    const line = (incident.lineNumber || 1) - 1; // Default to line 0 if lineNumber  missing
                    const message = incident.message || "No message provided";
                    const range = new vscode.Range(line, 0, line, 0);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        message,
                        severity
                    );

                    diagnostic.source = 'Konveyor'; // Change me
                    if (incident.codeSnip) {
                        diagnostic.code = incident.codeSnip;
                    }

                    const diagnostics = [...(diagnosticCollection.get(uri) || [])];
                    diagnostics.push(diagnostic);
                    diagnosticCollection.set(uri, diagnostics); 

                    // Add the diagnostic to the separate list for monitoring
                    diagnosticList.push(diagnostic);
                }
            });
        }
    });

    return diagnosticCollection; 
}

//only for testing can be ignored.... 
export function runDiagnosticsForFile(filePath: string): void {
    let outputChannel: vscode.OutputChannel;
    outputChannel = vscode.window.createOutputChannel('Konveyor Diagnostics');

    const ruleSets = readYamlFile(filePath);
   // vscode.window.showInformationMessage(`Size of the rulesets: ${ruleSets?.length || 0}`);
    
    if (ruleSets && ruleSets.length > 0) {
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('konveyor');
        const updatedDiagnosticCollection = processIncidents(ruleSets, diagnosticCollection);
        if (!outputChannel) {
            outputChannel = vscode.window.createOutputChannel('Konveyor Diagnostics');
        }
        logDiagnosticCollectionToOutputChannel(updatedDiagnosticCollection, outputChannel);
        
    } else {
        console.error('No valid rulesets found in the YAML file.');
        vscode.window.showErrorMessage('No valid rule sets found in the YAML file.');
    }
}

//this is only for testing purpose
function logDiagnosticCollectionToOutputChannel(diagnosticCollection: vscode.DiagnosticCollection, outputChannel: vscode.OutputChannel): void {
    outputChannel.clear(); 
    let totalDiagnosticsCount = 0;

    outputChannel.appendLine('--- Diagnostic Collection Report ---');

    diagnosticCollection.forEach((uri, diagnostics) => {
        outputChannel.appendLine(`File: ${uri.fsPath}`);
        outputChannel.appendLine(`Number of diagnostics: ${diagnostics.length}`);

        totalDiagnosticsCount += diagnostics.length;

        diagnostics.forEach((diagnostic, index) => {
            outputChannel.appendLine(`  Diagnostic ${index + 1}:`);
            outputChannel.appendLine(`    Range: Line ${diagnostic.range.start.line + 1}`);
            outputChannel.appendLine(`    Message: ${diagnostic.message}`);
            outputChannel.appendLine(`    Severity: ${vscode.DiagnosticSeverity[diagnostic.severity]}`);
            if (diagnostic.code) {
                outputChannel.appendLine(`    Code Snippet: ${diagnostic.code}`);
            }
            outputChannel.appendLine('----------------------');
        });
    });

    outputChannel.appendLine(`Total number of diagnostics: ${totalDiagnosticsCount}`);
    outputChannel.show(); 
}
