// Mask on / mask off for a first-person camera (Don Giovanni · The Final Defence).
//
// A hand lifts a mask into view, turns it, and presses it onto the face. At the press the
// screen blinks dark and the mask's eye-hole vignette fades in at the screen edges. Taking
// the mask off reverses this. Mask index: 0 = Don Giovanni, 1 = Donna Anna, 2 = Leporello.
//
// Every number comes from mask-fx/mask_fx.json; mask-fx/demo.html runs the same maths in a
// browser, so you can compare the two side by side.
//
// Needs the "Slate" and "SlateCore" modules in your Build.cs.

#pragma once

#include "CoreMinimal.h"
#include "Brushes/SlateColorBrush.h"
#include "Components/ActorComponent.h"
#include "Styling/SlateBrush.h"
#include "DGMaskFXComponent.generated.h"

class SImage;
class SOverlay;
class UCameraComponent;
class USceneComponent;
class USoundBase;
class UStaticMesh;
class UStaticMeshComponent;
class UTexture2D;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FDGMaskFXEvent, int32, MaskIndex);

/** The steps of the hand animation ("phases" in mask_fx.json). */
enum class EDGMaskFXPhase : uint8
{
	None,
	PutRise,	// the hand brings the mask up from below the screen and turns it
	PutPress,	// the mask is pressed onto the face
	PutDrop,	// the empty hand drops out of view
	TakeReach,	// the empty hand comes up to the face
	TakePull,	// the hand takes the mask away
};

/** One queued step: which phase, with which mask. */
struct FDGMaskFXStep
{
	EDGMaskFXPhase Phase = EDGMaskFXPhase::None;
	int32 Mask = INDEX_NONE;
};

/** A value that eases to a target along CSS "ease"; the time scales with the distance left. */
struct FDGMaskFXFade
{
	float Alpha = 0.f;
	float From = 0.f;
	float To = 0.f;
	float Time = 0.f;
	float Duration = 0.f;

	void Start(float Target, float FullSeconds);
	void Tick(float DeltaSeconds);
};

UCLASS(ClassGroup = (DonGiovanni), meta = (BlueprintSpawnableComponent))
class UDGMaskFXComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UDGMaskFXComponent();

	/** Put a mask on (0 = Don Giovanni, 1 = Donna Anna, 2 = Leporello). A mask already on the face
	 *  comes off first. Returns false, and does nothing, while busy or if that mask is already on. */
	UFUNCTION(BlueprintCallable, Category = "Mask FX")
	bool WearMask(int32 MaskIndex);

	/** Take the worn mask off. Returns false, and does nothing, while busy or with no mask on. */
	UFUNCTION(BlueprintCallable, Category = "Mask FX")
	bool RemoveMask();

	/** The mask on the face, or -1. It changes at OnMaskOn and OnMaskOff. */
	UFUNCTION(BlueprintPure, Category = "Mask FX")
	int32 GetWornMask() const { return WornMask; }

	/** True while the hand is moving. WearMask and RemoveMask are ignored then. */
	UFUNCTION(BlueprintPure, Category = "Mask FX")
	bool IsBusy() const;

	/** Use this camera instead of the first camera component found on the owner. */
	UFUNCTION(BlueprintCallable, Category = "Mask FX")
	void SetCamera(UCameraComponent* InCamera);

	// ---------------------------------------------------------------- Assets

	/** The first-person hand (SM_DG_Hand). Filled from DefaultAssetFolder at BeginPlay when empty. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Assets")
	TObjectPtr<UStaticMesh> HandMesh;

	/** 0 = Don Giovanni, 1 = Donna Anna, 2 = Leporello (SM_DG_Mask_*). Empty slots are filled from DefaultAssetFolder. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, EditFixedSize, Category = "Mask FX|Assets")
	TArray<TObjectPtr<UStaticMesh>> MaskMeshes;

	/** Full-screen eye-hole vignettes, same order (T_DG_Vignette_*). Empty slots are filled from DefaultAssetFolder. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, EditFixedSize, Category = "Mask FX|Assets")
	TArray<TObjectPtr<UTexture2D>> VignetteTextures;

	/** Optional, same order. Played when a mask is asked for (the greybox plays SFX_DG_MaskMotif_*). Never filled automatically. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, EditFixedSize, Category = "Mask FX|Assets")
	TArray<TObjectPtr<USoundBase>> WearSounds;

	/** Optional. Played when the hand starts to take a mask off (the greybox plays nothing). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Assets")
	TObjectPtr<USoundBase> RemoveSound;

	/** Where empty hand, mask and vignette slots are looked for at BeginPlay. For a packaged build, assign the
	 *  slots by hand or add this folder to "Additional Asset Directories to Cook". */
	UPROPERTY(EditAnywhere, Category = "Mask FX|Assets")
	FString DefaultAssetFolder = TEXT("/Game/DG/MaskFX");

	// ---------------------------------------------------------------- Look

	/** Scales the whole rig away from the eye. The picture stays the same. With UE's default 10 cm near clip
	 *  plane, use 1.6 so the fingers and the mask are not cut off near the face (or set the near clip plane to 5 cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look", meta = (ClampMin = "0.1", ClampMax = "4.0"))
	float RigScale = 1.f;

	/** Extra turn for the hand mesh, if your glTF import maps axes differently (see the axis check in the README). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	FRotator HandMeshRotation = FRotator::ZeroRotator;

	/** Extra turn for the mask meshes, for the same reason. At rotation 0 the face of the mask must point along +X. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	FRotator MaskMeshRotation = FRotator::ZeroRotator;

	/** Colour of the blink at the press (sRGB #0d0907). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	FLinearColor BlinkColor = FLinearColor(FColor(13, 9, 7));

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BlinkMaxAlpha = 0.92f;

	/** The blink rises along "ease" as if it took this long to reach BlinkMaxAlpha... */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	float BlinkRampSeconds = 0.30f;

	/** ...but lets go after this long (at about 0.71)... */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	float BlinkReleaseSeconds = 0.14f;

	/** ...and fades out over this long. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	float BlinkFadeSeconds = 0.23f;

	/** A full vignette fade in or out. A fade that starts half way takes half as long. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Look")
	float VignetteFadeSeconds = 0.9f;

	/** Z order of the vignette and blink layer among the viewport widgets. */
	UPROPERTY(EditAnywhere, Category = "Mask FX|Look")
	int32 OverlayZOrder = 10;

	// ---------------------------------------------------------------- Timing (seconds)

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Timing")
	float PutRiseSeconds = 0.50f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Timing")
	float PutPressSeconds = 0.30f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Timing")
	float PutDropSeconds = 0.35f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Timing")
	float TakeReachSeconds = 0.28f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Timing")
	float TakePullSeconds = 0.45f;

	/** OnSceneCue fires this long after the put starts (the greybox starts moving the scenery here). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Mask FX|Timing")
	float SceneCueSeconds = 0.42f;

	// ---------------------------------------------------------------- Poses (camera space: X forward, Y right, Z up, cm)

	/** Palm when the put starts, below the screen on the right. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	FVector PoseStart = FVector(42.f, 22.f, -44.f);

	/** Palm in front of the chest, where the mask is shown and turned. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	FVector PoseShow = FVector(33.f, 2.5f, -13.f);

	/** Palm when the mask is on the face. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	FVector PoseFace = FVector(8.5f, 0.f, -10.f);

	/** Palm after the put and before the take, below the screen on the right. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	FVector PoseRest = FVector(30.f, 20.f, -55.f);

	/** Palm when the take ends, below the screen on the right. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	FVector PoseTakeEnd = FVector(45.f, 26.f, -50.f);

	/** Mask pivot = palm + this offset, in camera space (it does not turn with the hand). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	FVector MaskOffset = FVector(1.2f, 0.f, 11.5f);

	/** Hand pitch and roll (degrees) when the put starts; they ease to 0 by PoseShow. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float RiseStartPitch = -40.11f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float RiseStartRoll = -20.05f;

	/** Hand pitch and roll at PoseRest. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float RestPitch = 28.65f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float RestRoll = 17.19f;

	/** Hand pitch and roll at PoseTakeEnd. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float TakeEndPitch = -34.38f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float TakeEndRoll = -17.19f;

	/** The mask follows this share of the hand's pitch and roll. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses")
	float MaskTilt = 0.6f;

	/** During PutRise the mask turns from its face to its inside once the eased progress passes this. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, AdvancedDisplay, Category = "Mask FX|Poses", meta = (ClampMin = "0.0", ClampMax = "0.95"))
	float TurnFrom = 0.35f;

	// ---------------------------------------------------------------- Events (the argument is the mask index)

	/** A wear was accepted (before any take of the old mask). */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnWearRequested;

	/** The hand starts to bring the mask up. */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnPutStarted;

	/** SceneCueSeconds after OnPutStarted, while the hand is still rising: start changing the scene here. */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnSceneCue;

	/** The mask touches the face: it disappears from the hand, the screen blinks, the vignette fades in. */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnMaskOn;

	/** The empty hand is out of view again. */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnPutFinished;

	/** The hand starts to come up for the mask (the greybox puts the scene back here). */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnTakeStarted;

	/** The mask leaves the face: it appears in the hand, the vignette fades out. */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnMaskOff;

	/** The hand and the mask are out of view. */
	UPROPERTY(BlueprintAssignable, Category = "Mask FX|Events")
	FDGMaskFXEvent OnTakeFinished;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	void LoadDefaultAssets();
	void EnsureRig();
	void EnsureOverlay();
	void RemoveOverlay();
	void StartNextStep();
	void FinishStep();
	float StepSeconds(EDGMaskFXPhase InPhase) const;
	float BlinkAlpha() const;
	void ApplyPose();
	void UpdateOverlay();

	UPROPERTY(Transient)
	TObjectPtr<UCameraComponent> Camera;

	UPROPERTY(Transient)
	TObjectPtr<USceneComponent> RigRoot;

	UPROPERTY(Transient)
	TObjectPtr<UStaticMeshComponent> HandComponent;

	UPROPERTY(Transient)
	TObjectPtr<UStaticMeshComponent> MaskComponent;

	TArray<FDGMaskFXStep> Queue;
	EDGMaskFXPhase Phase = EDGMaskFXPhase::None;
	int32 PhaseMask = INDEX_NONE;
	float PhaseTime = 0.f;
	float PutClock = -1.f;		// seconds since PutRise started; -1 outside a put
	bool bSceneCueSent = false;
	int32 WornMask = INDEX_NONE;

	FDGMaskFXFade VignetteFades[3];
	float BlinkTime = -1.f;		// seconds since the press; -1 = no blink

	TSharedPtr<SOverlay> Overlay;
	TSharedPtr<SImage> VignetteImages[3];
	TSharedPtr<SImage> BlinkImage;
	FSlateBrush VignetteBrushes[3];
	FSlateColorBrush BlinkBrush = FSlateColorBrush(FLinearColor::White);
};
