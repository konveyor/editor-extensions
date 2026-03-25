/**
 * Deterministic LLM responses for savitharaghunathan/gotest when using llemulator (CI).
 * Matches real file shapes so Get Solution → Accept can complete without a live model.
 *
 * The workflow applies two separate fixes (two Get Solution → Accept steps):
 * 1. **main.go** — autoscaling/v2beta1 → v2 (covers the two autoscaling-related issues).
 * 2. **go.mod** — bump k8s.io/client-go (and api/apimachinery) for the dependency issue.
 *
 * Each scripted reply has a single `## Updated File` block; Kai applies one target file per solution.
 */
import {
  buildKaiResponse,
  loadLlemulatorResponses,
  type LlemulatorPatternRule,
} from '../utilities/llemulator.utils';

/** main.go migrated from autoscaling/v2beta1 to autoscaling/v2 (addresses first two issues). */
const MAIN_GO_MIGRATED = `package main

import (
	"context"
	"flag"
	"path/filepath"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	"k8s.io/klog/v2"
)

func main() {
	var kubeconfig *string
	if home := homedir.HomeDir(); home != "" {
		kubeconfig = flag.String("kubeconfig", filepath.Join(home, ".kube", "config"), "(optional) absolute path to the kubeconfig file")
	} else {
		kubeconfig = flag.String("kubeconfig", "", "absolute path to the kubeconfig file")
	}
	flag.Parse()

	config, err := clientcmd.BuildConfigFromFlags("", *kubeconfig)
	if err != nil {
		klog.Fatalf("Error building kubeconfig: %v", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		klog.Fatalf("Error creating Kubernetes client: %v", err)
	}

	ctx := context.Background()
	namespace := "default"

	klog.Info("=== Creating Deployment ===")
	if err := createDeployment(ctx, clientset, namespace); err != nil {
		klog.Fatalf("Failed to create deployment: %v", err)
	}

	klog.Info("=== Creating HPA using autoscaling/v2 API ===")
	if err := createHPA(ctx, clientset, namespace); err != nil {
		klog.Fatalf("Failed to create HPA: %v", err)
	}

	klog.Info("Demo completed successfully!")
}

func createDeployment(ctx context.Context, clientset *kubernetes.Clientset, namespace string) error {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "nginx-deployment",
			Namespace: namespace,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: int32Ptr(2),
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "nginx",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app": "nginx",
					},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "nginx",
							Image: "nginx:1.20",
							Ports: []corev1.ContainerPort{
								{
									ContainerPort: 80,
								},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("100m"),
									corev1.ResourceMemory: resource.MustParse("128Mi"),
								},
							},
						},
					},
				},
			},
		},
	}

	_, err := clientset.AppsV1().Deployments(namespace).Create(ctx, deployment, metav1.CreateOptions{})
	if err != nil {
		return err
	}

	klog.Info("Created Deployment: nginx-deployment")
	return nil
}

func createHPA(ctx context.Context, clientset *kubernetes.Clientset, namespace string) error {
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "nginx-hpa",
			Namespace: namespace,
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "nginx-deployment",
			},
			MinReplicas: int32Ptr(2),
			MaxReplicas: 10,
			Metrics: []autoscalingv2.MetricSpec{
				{
					Type: autoscalingv2.ResourceMetricSourceType,
					Resource: &autoscalingv2.ResourceMetricSource{
						Name: corev1.ResourceCPU,
						Target: autoscalingv2.MetricTarget{
							Type:               autoscalingv2.UtilizationMetricType,
							AverageUtilization: int32Ptr(70),
						},
					},
				},
			},
		},
	}

	_, err := clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Create(ctx, hpa, metav1.CreateOptions{})
	if err != nil {
		return err
	}

	klog.Info("Created HPA using autoscaling/v2: nginx-hpa")
	return nil
}

func int32Ptr(i int32) *int32 {
	return &i
}
`;

/**
 * Second solution only: **go.mod** (dependency / client-go issue).
 * First solution must not touch this; patterns route autoscaling vs dependency requests.
 */
const GO_MOD_UPDATED = `module github.com/kai-examples/old

go 1.22

require (
	k8s.io/api v0.34.0
	k8s.io/apimachinery v0.34.0
	k8s.io/client-go v0.34.0
	k8s.io/klog/v2 v2.130.1
)
`;

function gotestLlemulatorRules(): LlemulatorPatternRule[] {
  return [
    {
      pattern: 'v2beta1|autoscaling/v2beta1|HorizontalPodAutoscaler|Migrate deprecated|nginx-hpa',
      response: buildKaiResponse({
        reasoning:
          'Updated **main.go** only: migrated HorizontalPodAutoscaler from autoscaling/v2beta1 to autoscaling/v2 and adjusted metric targets.',
        language: 'go',
        fileContent: MAIN_GO_MIGRATED,
        additionalInfo:
          'Applies to main.go. Uses AutoscalingV2 and MetricTarget.AverageUtilization.',
      }),
      times: -1,
    },
    {
      // Do not match `k8s.io/client-go` alone — main.go imports it; the autoscaling request would get go.mod.
      pattern: 'Update Kubernetes client-go|v1\\.34 compatible|go\\.mod',
      response: buildKaiResponse({
        reasoning:
          'Updated **go.mod** only: bumped k8s.io/client-go, k8s.io/api, and k8s.io/apimachinery to v0.34.x for Kubernetes 1.34 compatibility.',
        language: 'go',
        fileContent: GO_MOD_UPDATED,
        additionalInfo: 'Applies to go.mod. Run go mod tidy after apply.',
      }),
      times: -1,
    },
  ];
}

/** Load scripted responses into llemulator before starting VS Code (same pattern as fix-one-issue). */
export async function loadGotestWorkflowLlemulatorResponses(): Promise<void> {
  await loadLlemulatorResponses({
    reset: true,
    responses: gotestLlemulatorRules(),
  });
}
