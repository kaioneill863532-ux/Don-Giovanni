// See DGMaskFXComponent.h. The maths matches mask-fx/demo.html line for line.

#include "DGMaskFXComponent.h"

#include "Camera/CameraComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/GameViewportClient.h"
#include "Engine/StaticMesh.h"
#include "Engine/Texture2D.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/SoundBase.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/SOverlay.h"

namespace DGMaskFX
{
	static constexpr int32 MaskCount = 3;
	static const TCHAR* const MaskNames[MaskCount] = { TEXT("Don"), TEXT("Anna"), TEXT("Leporello") };

	static float EaseInOutCubic(float T)
	{
		return T < 0.5f ? 4.f * T * T * T : 1.f - FMath::Pow(-2.f * T + 2.f, 3.f) * 0.5f;
	}

	/** CSS "ease" = cubic-bezier(0.25, 0.1, 0.25, 1.0), the curve of the greybox's blink and vignette fades. */
	static float CssEase(float X)
	{
		X = FMath::Clamp(X, 0.f, 1.f);
		constexpr float X1 = 0.25f, Y1 = 0.1f, X2 = 0.25f, Y2 = 1.0f;
		float T = X;
		for (int32 Iteration = 0; Iteration < 8; ++Iteration)	// Newton: find T with BezierX(T) = X
		{
			const float U = 1.f - T;
			const float Bx = 3.f * U * U * T * X1 + 3.f * U * T * T * X2 + T * T * T;
			const float Dx = 3.f * U * U * X1 + 6.f * U * T * (X2 - X1) + 3.f * T * T * (1.f - X2);
			T = FMath::Clamp(T - (Bx - X) / FMath::Max(Dx, 1e-6f), 0.f, 1.f);
		}
		const float U = 1.f - T;
		return 3.f * U * U * T * Y1 + 3.f * U * T * T * Y2 + T * T * T;
	}
}

void FDGMaskFXFade::Start(float Target, float FullSeconds)
{
	From = Alpha;
	To = Target;
	Time = 0.f;
	Duration = FMath::Max(FullSeconds * FMath::Abs(Target - Alpha), 1e-4f);
}

void FDGMaskFXFade::Tick(float DeltaSeconds)
{
	if (Alpha == To)
	{
		return;
	}
	Time += DeltaSeconds;
	const float K = Time / Duration;
	Alpha = K >= 1.f ? To : FMath::Lerp(From, To, DGMaskFX::CssEase(K));
}

UDGMaskFXComponent::UDGMaskFXComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = true;
	MaskMeshes.SetNum(DGMaskFX::MaskCount);
	VignetteTextures.SetNum(DGMaskFX::MaskCount);
	WearSounds.SetNum(DGMaskFX::MaskCount);
}

void UDGMaskFXComponent::BeginPlay()
{
	Super::BeginPlay();
	LoadDefaultAssets();
	EnsureRig();
}

void UDGMaskFXComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	RemoveOverlay();
	Super::EndPlay(EndPlayReason);
}

bool UDGMaskFXComponent::IsBusy() const
{
	return Phase != EDGMaskFXPhase::None || Queue.Num() > 0;
}

void UDGMaskFXComponent::SetCamera(UCameraComponent* InCamera)
{
	Camera = InCamera;
	if (RigRoot && Camera)
	{
		RigRoot->AttachToComponent(Camera, FAttachmentTransformRules::KeepRelativeTransform);
	}
}

bool UDGMaskFXComponent::WearMask(int32 MaskIndex)
{
	if (IsBusy() || MaskIndex == WornMask || MaskIndex < 0 || MaskIndex >= DGMaskFX::MaskCount)
	{
		return false;
	}
	EnsureRig();
	if (!RigRoot)
	{
		return false;
	}
	EnsureOverlay();

	if (WornMask != INDEX_NONE)	// swap: the old mask comes off first
	{
		Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::TakeReach, WornMask });
		Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::TakePull, WornMask });
	}
	Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::PutRise, MaskIndex });
	Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::PutPress, MaskIndex });
	Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::PutDrop, MaskIndex });

	if (WearSounds.IsValidIndex(MaskIndex) && WearSounds[MaskIndex])
	{
		UGameplayStatics::PlaySound2D(this, WearSounds[MaskIndex]);
	}
	OnWearRequested.Broadcast(MaskIndex);	// already busy here, so a listener cannot start another wear
	StartNextStep();
	return true;
}

bool UDGMaskFXComponent::RemoveMask()
{
	if (IsBusy() || WornMask == INDEX_NONE)
	{
		return false;
	}
	EnsureRig();
	if (!RigRoot)
	{
		return false;
	}
	EnsureOverlay();
	Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::TakeReach, WornMask });
	Queue.Add(FDGMaskFXStep{ EDGMaskFXPhase::TakePull, WornMask });
	StartNextStep();
	return true;
}

void UDGMaskFXComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	// Run the steps; a long frame can finish one step and carry on into the next.
	float Left = DeltaTime;
	while (Phase != EDGMaskFXPhase::None)
	{
		const float Duration = StepSeconds(Phase);
		const float Step = FMath::Max(0.f, FMath::Min(Left, Duration - PhaseTime));
		PhaseTime += Step;
		Left -= Step;
		if (PutClock >= 0.f)
		{
			PutClock += Step;
			if (!bSceneCueSent && PutClock >= SceneCueSeconds)
			{
				bSceneCueSent = true;
				OnSceneCue.Broadcast(PhaseMask);
			}
		}
		if (PhaseTime >= Duration)
		{
			FinishStep();
		}
		else
		{
			break;
		}
	}

	for (FDGMaskFXFade& Fade : VignetteFades)
	{
		Fade.Tick(DeltaTime);
	}
	if (BlinkTime >= 0.f)
	{
		BlinkTime += DeltaTime;
		if (BlinkTime > BlinkReleaseSeconds + BlinkFadeSeconds)
		{
			BlinkTime = -1.f;
		}
	}

	ApplyPose();
	UpdateOverlay();
}

void UDGMaskFXComponent::StartNextStep()
{
	if (Queue.Num() == 0)
	{
		Phase = EDGMaskFXPhase::None;
		PhaseMask = INDEX_NONE;
		PhaseTime = 0.f;
		return;
	}
	const FDGMaskFXStep Next = Queue[0];
	Queue.RemoveAt(0);
	Phase = Next.Phase;
	PhaseMask = Next.Mask;
	PhaseTime = 0.f;
	if (MaskComponent)
	{
		MaskComponent->SetStaticMesh(MaskMeshes.IsValidIndex(PhaseMask) ? MaskMeshes[PhaseMask].Get() : nullptr);
	}

	if (Phase == EDGMaskFXPhase::PutRise)
	{
		PutClock = 0.f;
		bSceneCueSent = false;
		OnPutStarted.Broadcast(PhaseMask);
	}
	else if (Phase == EDGMaskFXPhase::TakeReach)
	{
		if (RemoveSound)
		{
			UGameplayStatics::PlaySound2D(this, RemoveSound);
		}
		OnTakeStarted.Broadcast(PhaseMask);
	}
}

void UDGMaskFXComponent::FinishStep()
{
	const EDGMaskFXPhase Done = Phase;
	const int32 Mask = PhaseMask;

	if (Done == EDGMaskFXPhase::PutPress)
	{
		WornMask = Mask;
		BlinkTime = 0.f;
		VignetteFades[Mask].Start(1.f, VignetteFadeSeconds);
		OnMaskOn.Broadcast(Mask);
	}
	else if (Done == EDGMaskFXPhase::TakeReach)
	{
		WornMask = INDEX_NONE;
		VignetteFades[Mask].Start(0.f, VignetteFadeSeconds);
		OnMaskOff.Broadcast(Mask);
	}
	else if (Done == EDGMaskFXPhase::PutDrop)
	{
		PutClock = -1.f;
	}

	Phase = EDGMaskFXPhase::None;	// this step is over; IsBusy() stays true while more steps wait (a swap)
	if (Done == EDGMaskFXPhase::PutDrop)
	{
		OnPutFinished.Broadcast(Mask);
	}
	else if (Done == EDGMaskFXPhase::TakePull)
	{
		OnTakeFinished.Broadcast(Mask);
	}
	if (Phase == EDGMaskFXPhase::None)	// unless a listener has already started something new
	{
		StartNextStep();
	}
}

float UDGMaskFXComponent::StepSeconds(EDGMaskFXPhase InPhase) const
{
	switch (InPhase)
	{
	case EDGMaskFXPhase::PutRise:	return PutRiseSeconds;
	case EDGMaskFXPhase::PutPress:	return PutPressSeconds;
	case EDGMaskFXPhase::PutDrop:	return PutDropSeconds;
	case EDGMaskFXPhase::TakeReach:	return TakeReachSeconds;
	case EDGMaskFXPhase::TakePull:	return TakePullSeconds;
	default:						return 0.f;
	}
}

float UDGMaskFXComponent::BlinkAlpha() const
{
	if (BlinkTime < 0.f)
	{
		return 0.f;
	}
	const float Peak = BlinkMaxAlpha * DGMaskFX::CssEase(FMath::Min(BlinkTime, BlinkReleaseSeconds) / FMath::Max(BlinkRampSeconds, 1e-4f));
	if (BlinkTime <= BlinkReleaseSeconds)
	{
		return Peak;
	}
	const float U = (BlinkTime - BlinkReleaseSeconds) / FMath::Max(BlinkFadeSeconds, 1e-4f);
	return U >= 1.f ? 0.f : Peak * (1.f - DGMaskFX::CssEase(U));
}

void UDGMaskFXComponent::ApplyPose()
{
	if (!RigRoot || !HandComponent || !MaskComponent)
	{
		return;
	}
	const FVector Scale(RigScale);
	if (!RigRoot->GetRelativeScale3D().Equals(Scale))
	{
		RigRoot->SetRelativeScale3D(Scale);
	}

	if (Phase == EDGMaskFXPhase::None)
	{
		HandComponent->SetVisibility(false);
		MaskComponent->SetVisibility(false);
		return;
	}

	// Each step goes from one palm pose to the next; pitch and roll ease along with it (yaw stays 0).
	const float U = FMath::Clamp(PhaseTime / FMath::Max(StepSeconds(Phase), 1e-4f), 0.f, 1.f);
	float K = DGMaskFX::EaseInOutCubic(U);
	FVector From = PoseFace, To = PoseFace;
	float PitchFrom = 0.f, PitchTo = 0.f, RollFrom = 0.f, RollTo = 0.f;
	bool bMaskShown = false;
	switch (Phase)
	{
	case EDGMaskFXPhase::PutRise:
		From = PoseStart; To = PoseShow; PitchFrom = RiseStartPitch; RollFrom = RiseStartRoll; bMaskShown = true;
		break;
	case EDGMaskFXPhase::PutPress:
		K = U * U;	// faster and faster
		From = PoseShow; To = PoseFace; bMaskShown = true;
		break;
	case EDGMaskFXPhase::PutDrop:
		From = PoseFace; To = PoseRest; PitchTo = RestPitch; RollTo = RestRoll;
		break;
	case EDGMaskFXPhase::TakeReach:
		From = PoseRest; To = PoseFace; PitchFrom = RestPitch; RollFrom = RestRoll;
		break;
	case EDGMaskFXPhase::TakePull:
		From = PoseFace; To = PoseTakeEnd; PitchTo = TakeEndPitch; RollTo = TakeEndRoll; bMaskShown = true;
		break;
	default:
		break;
	}

	const FVector HandLocation = FMath::Lerp(From, To, K);
	const float Pitch = FMath::Lerp(PitchFrom, PitchTo, K);
	const float Roll = FMath::Lerp(RollFrom, RollTo, K);
	HandComponent->SetVisibility(HandComponent->GetStaticMesh() != nullptr);
	HandComponent->SetRelativeTransform(FTransform(HandMeshRotation) * FTransform(FRotator(Pitch, 0.f, Roll), HandLocation));

	// The mask: turn 0 shows its face to the player, 1 its inside. Its three turns are applied one after
	// another about the camera's axes - roll, then the turn (yaw), then pitch. One FRotator(Pitch, Yaw, Roll)
	// would apply pitch before the turn and lean the mask the wrong way while it shows its face.
	const float Turn = Phase == EDGMaskFXPhase::PutRise ? FMath::Clamp((K - TurnFrom) / (1.f - TurnFrom), 0.f, 1.f) : 1.f;
	const FQuat MaskRotation = FQuat(FRotator(MaskTilt * Pitch, 0.f, 0.f))
		* FQuat(FRotator(0.f, -180.f * (1.f - Turn), 0.f))
		* FQuat(FRotator(0.f, 0.f, MaskTilt * Roll));
	MaskComponent->SetVisibility(bMaskShown && MaskComponent->GetStaticMesh() != nullptr);
	MaskComponent->SetRelativeTransform(FTransform(MaskMeshRotation) * FTransform(MaskRotation, HandLocation + MaskOffset));
}

void UDGMaskFXComponent::UpdateOverlay()
{
	if (!Overlay.IsValid())
	{
		return;
	}
	for (int32 i = 0; i < DGMaskFX::MaskCount; ++i)
	{
		if (VignetteImages[i].IsValid())
		{
			VignetteImages[i]->SetColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, VignetteFades[i].Alpha));
		}
	}
	if (BlinkImage.IsValid())
	{
		BlinkImage->SetColorAndOpacity(FLinearColor(BlinkColor.R, BlinkColor.G, BlinkColor.B, BlinkAlpha()));
	}
}

void UDGMaskFXComponent::LoadDefaultAssets()
{
	auto Load = [this](const FString& Name) -> UObject*
	{
		const FString Path = FString::Printf(TEXT("%s/%s.%s"), *DefaultAssetFolder, *Name, *Name);
		return StaticLoadObject(UObject::StaticClass(), nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
	};
	MaskMeshes.SetNum(DGMaskFX::MaskCount);
	VignetteTextures.SetNum(DGMaskFX::MaskCount);
	WearSounds.SetNum(DGMaskFX::MaskCount);
	if (!HandMesh)
	{
		HandMesh = Cast<UStaticMesh>(Load(TEXT("SM_DG_Hand")));
	}
	for (int32 i = 0; i < DGMaskFX::MaskCount; ++i)
	{
		if (!MaskMeshes[i])
		{
			MaskMeshes[i] = Cast<UStaticMesh>(Load(FString::Printf(TEXT("SM_DG_Mask_%s"), DGMaskFX::MaskNames[i])));
		}
		if (!VignetteTextures[i])
		{
			VignetteTextures[i] = Cast<UTexture2D>(Load(FString::Printf(TEXT("T_DG_Vignette_%s"), DGMaskFX::MaskNames[i])));
		}
	}
}

void UDGMaskFXComponent::EnsureRig()
{
	if (RigRoot)
	{
		return;
	}
	AActor* OwnerActor = GetOwner();
	if (!Camera && OwnerActor)
	{
		Camera = OwnerActor->FindComponentByClass<UCameraComponent>();
	}
	if (!Camera || !OwnerActor)
	{
		UE_LOG(LogTemp, Warning, TEXT("DGMaskFX: %s has no camera component. Call SetCamera first."), *GetNameSafe(OwnerActor));
		return;
	}

	RigRoot = NewObject<USceneComponent>(OwnerActor, MakeUniqueObjectName(OwnerActor, USceneComponent::StaticClass(), TEXT("MaskFXRig")));
	RigRoot->SetupAttachment(Camera);
	RigRoot->RegisterComponent();
	RigRoot->SetRelativeScale3D(FVector(RigScale));

	auto MakeMesh = [this, OwnerActor](const TCHAR* BaseName)
	{
		UStaticMeshComponent* Mesh = NewObject<UStaticMeshComponent>(OwnerActor, MakeUniqueObjectName(OwnerActor, UStaticMeshComponent::StaticClass(), BaseName));
		Mesh->SetupAttachment(RigRoot);
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Mesh->SetGenerateOverlapEvents(false);
		Mesh->SetCastShadow(false);
		Mesh->SetVisibility(false);
		Mesh->RegisterComponent();
		return Mesh;
	};
	HandComponent = MakeMesh(TEXT("MaskFXHand"));
	HandComponent->SetStaticMesh(HandMesh);
	MaskComponent = MakeMesh(TEXT("MaskFXMask"));
}

void UDGMaskFXComponent::EnsureOverlay()
{
	if (Overlay.IsValid())
	{
		return;
	}
	UWorld* World = GetWorld();
	UGameViewportClient* Viewport = World ? World->GetGameViewport() : nullptr;
	if (!Viewport)
	{
		return;
	}

	SAssignNew(Overlay, SOverlay).Visibility(EVisibility::HitTestInvisible);
	for (int32 i = 0; i < DGMaskFX::MaskCount; ++i)
	{
		UTexture2D* Texture = VignetteTextures.IsValidIndex(i) ? VignetteTextures[i].Get() : nullptr;
		VignetteBrushes[i] = FSlateBrush();
		if (Texture)
		{
			VignetteBrushes[i].SetResourceObject(Texture);
			VignetteBrushes[i].ImageSize = FVector2D(Texture->GetSizeX(), Texture->GetSizeY());
			VignetteBrushes[i].ImageType = ESlateBrushImageType::FullColor;
		}
		// Each image fills the viewport: the vignette is stretched to the screen, like the greybox does.
		Overlay->AddSlot()
		[
			SAssignNew(VignetteImages[i], SImage)
			.Image(&VignetteBrushes[i])
			.ColorAndOpacity(FLinearColor(1.f, 1.f, 1.f, 0.f))
			.Visibility(Texture ? EVisibility::HitTestInvisible : EVisibility::Collapsed)
		];
	}
	Overlay->AddSlot()
	[
		SAssignNew(BlinkImage, SImage)
		.Image(&BlinkBrush)
		.ColorAndOpacity(FLinearColor(BlinkColor.R, BlinkColor.G, BlinkColor.B, 0.f))
		.Visibility(EVisibility::HitTestInvisible)
	];
	Viewport->AddViewportWidgetContent(Overlay.ToSharedRef(), OverlayZOrder);
}

void UDGMaskFXComponent::RemoveOverlay()
{
	if (!Overlay.IsValid())
	{
		return;
	}
	if (UWorld* World = GetWorld())
	{
		if (UGameViewportClient* Viewport = World->GetGameViewport())
		{
			Viewport->RemoveViewportWidgetContent(Overlay.ToSharedRef());
		}
	}
	Overlay.Reset();
	BlinkImage.Reset();
	for (TSharedPtr<SImage>& Image : VignetteImages)
	{
		Image.Reset();
	}
}
