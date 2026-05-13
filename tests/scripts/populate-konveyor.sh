#!/bin/bash

baseName="Test"
count=10

declare -A app1=(
  [name]="Tackle-testapp public"
  [url]="https://github.com/abrugaro/tackle-testapp-public"
  [oldBranch]="main"
  [newBranch]="hardcode-ip-fix"
  [target]="cloud-readiness"
)

declare -A app2=(
  [name]="Day Trader"
  [url]="https://github.com/abrugaro/sample.daytrader7.git"
  [oldBranch]="master"
  [newBranch]="fixes"
  [target]="cloud-readiness"
)

declare -A app3=(
  [name]="Ticket Monster"
  [url]="https://github.com/jmle/monolith.git"
  [oldBranch]="master"
  [newBranch]="quarkus"
  [target]="quarkus"
)

declare -A app4=(
  [name]="Hello world"
  [url]="https://github.com/savitharaghunathan/helloworld-mdb.git"
  [oldBranch]="main"
  [newBranch]="quarkus"
  [target]="quarkus"
)

apps=("app1" "app2" "app3" "app4")
declare -A createdApps

pid=$$
self=$(basename $0)
tmp=/tmp/${self}-${pid}

usage() {
  echo "Usage: ${self} <required> <options>"
  echo "-h help"
  echo "Auth has to be disabled in order to execute this script"
  echo "Required:"
  echo "  -u <URL> URL of the hub"
  echo "Example:"
  echo "  ${self} -u htps://my-konveyor-instance/hub -n 5"
  echo "Options:"
  echo "  -b base name (Test)"
  echo "  -n count  (10)"
  echo "  -o output"
}

while getopts "u:b:n:o:h" arg; do
  case $arg in
  u)
    host=$OPTARG
    ;;
  b)
    baseName=$OPTARG
    ;;
  n)
    count=$OPTARG
    ;;
  o)
    output=$OPTARG
    ;;
  h)
    usage
    exit 1
    ;;
  *)
    usage
    exit 1
    ;;
  esac
done

if [ -z "${host}" ]; then
  echo "-u required."
  usage
  exit 0
fi

print() {
  if [ -n "$output" ]; then
    echo -e "$@" >>"$output"
  else
    echo -e "$@"
  fi
}

echo
echo "Host:   ${host}"
echo "Name:   ${baseName}"
echo "Count:  ${count}"
echo
answer="y"
read -rp "Continue[Y,n]: " answer
if [ "$answer" != "y" ]; then
  exit 0
fi

createAnalysis() {
  appId=$1
  appName=$2
  appTarget=$3
  d="
{
    \"name\": \"taskgroup.analyzer\",
    \"kind\": \"analyzer\",
    \"state\": \"Created\",
    \"priority\": 10,
    \"data\": {
        \"tagger\": {
            \"enabled\": true
        },
        \"mode\": {
            \"binary\": false,
            \"withDeps\": true
        },
        \"rules\": {
            \"labels\": {
                \"included\": [
                    \"konveyor.io/target=${appTarget}\"
                ]
            }
        }
    },
    \"tasks\": [
        {
            \"name\": \"${appName}.${appId}.windup\",
            \"application\": {
                \"id\": ${appId},
                \"name\": \"${appName}\"
            }
        }
    ]
}"

  # Create TaskGroup
  code=$(curl -kSs -o "$tmp" -w "%{http_code}" -X POST "${host}/taskgroups" -H 'Content-Type:application/json' -H 'Accept: application/json' -d "$d")
  ret=$?
  if [ ! $ret -eq 0 ]; then
    exit $ret
  fi
  case ${code} in
  201)
    taskGroupId=$(jq .id "$tmp")
    print "TaskGroup $taskGroupId CREATED Taskgroup for application: $appName id=${appId}"
    ;;
  *)
    print "Create task for: appId=${appId} - FAILED: $code."
    cat "$tmp"
    exit 1
    ;;
  esac

  # Start analysis
  code=$(curl -kSs -o "$tmp" -w "%{http_code}" -X PUT "${host}/taskgroups/${taskGroupId}/submit" -H 'Content-Type:application/json' -d "$d")
  ret=$?
  if [ ! $ret -eq 0 ]; then
    exit $ret
  fi
  case ${code} in
  204)
    id=$(jq .id "$tmp")
    print "Analysis $id STARTED for application: $appName id=${appId}"
    ;;
  *)
    print "Start analysis for: appId=${appId} - FAILED: $code."
    cat "$tmp"
    exit 1
    ;;
  esac
}

updateBranch() {
  appId=$1
  appName=$2
  repositoryUrl=$3
  newBranch=$4
  d="
---
name: $appName
description: $appName Test application.
repository:
  kind: git
  branch: $newBranch
  url: $repositoryUrl
tags:
"
  code=$(curl -kSs -o "$tmp" -w "%{http_code}" -X PUT "${host}/applications/${appId}" -H 'Content-Type:application/x-yaml' -d "$d")
  ret=$?
  if [ ! $ret -eq 0 ]; then
    exit $ret
  fi
  case $code in
  204)
    print "Application $appName id=${appId} - UPDATED"
    ;;
  *)
    print "Update application $appName - FAILED: $code."
    cat "$tmp"
    exit 1
    ;;
  esac
}

waitForAnalyses() {
  while true; do
    code=$(curl -kSs -o "$tmp" -w "%{http_code}" "${host}/tasks/report/queue")
    total=$(jq .total "$tmp")

    if [ "$total" -eq 0 ]; then
      echo "All analyses are finished"
      break
    fi

    echo "Some analyses are still running, waiting 1 min..."
    sleep 60
  done
}

createApplications() {
  for i in $(seq 1 "$count"); do

    randomApp=${apps[$RANDOM % ${#apps[@]}]}

    appName="$(eval echo \${"${randomApp}"[name]})-$i"
    appUrl=$(eval echo \${"${randomApp}"[url]})
    appBranch=$(eval echo \${"${randomApp}"[oldBranch]})
    appTarget=$(eval echo \${"${randomApp}"[target]})

    d="
---
name: $appName
description: $appName Test application.
repository:
  kind: git
  branch: $appBranch
  url: $appUrl
tags:
- id: 16
"
    code=$(curl -kSs -o "$tmp" -w "%{http_code}" -X POST "${host}"/applications -H 'Content-Type:application/x-yaml' -d "$d")
    ret=$?
    if [ ! $ret -eq 0 ]; then
      exit $ret
    fi
    case $code in
    201)
      id=$(jq .id "$tmp")
      print "Application $appName id=${id} - CREATED"

      createdApps["${id}"]="${randomApp}"

      createAnalysis "$id" "$appName" "$appTarget"
      ;;
    *)
      print "Create application $appName - FAILED: $code."
      cat "$tmp"
      exit 1
      ;;
    esac
  done

  waitForAnalyses

  for appId in "${!createdApps[@]}"; do
    appKey="${createdApps[$appId]}"

    appName=$(eval echo \${"${appKey}"[name]})
    appUrl=$(eval echo \${"${appKey}"[url]})
    appTarget=$(eval echo \${"${appKey}"[target]})
    appNewBranch=$(eval echo \${"${appKey}"[newBranch]})

    updateBranch "$appId" "${appName}-${appId}" "$appUrl" "$appNewBranch"

    createAnalysis "$appId" "${appName}-${appId}" "$appTarget"
  done

  waitForAnalyses

}

createApplications
