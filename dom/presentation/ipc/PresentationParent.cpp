/* -*- Mode: c++; c-basic-offset: 2; indent-tabs-mode: nil; tab-width: 40 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/ipc/InputStreamUtils.h"
#include "nsIPresentationDeviceManager.h"
#include "nsServiceManagerUtils.h"
#include "PresentationParent.h"
#include "PresentationService.h"

using namespace mozilla::dom;

/*
 * Implementation of PresentationParent
 */

NS_IMPL_ISUPPORTS(PresentationParent,
                  nsIPresentationAvailabilityListener,
                  nsIPresentationSessionListener,
                  nsIPresentationRespondingListener)

PresentationParent::PresentationParent()
  : mActorDestroyed(false)
{
  MOZ_COUNT_CTOR(PresentationParent);
}

/* virtual */ PresentationParent::~PresentationParent()
{
  MOZ_COUNT_DTOR(PresentationParent);
}

bool
PresentationParent::Init()
{
  MOZ_ASSERT(!mService);
  mService = do_GetService(PRESENTATION_SERVICE_CONTRACTID);
  return NS_WARN_IF(!mService) ? false : true;
}

void
PresentationParent::ActorDestroy(ActorDestroyReason aWhy)
{
  mActorDestroyed = true;

  for (uint32_t i = 0; i < mSessionIdsAtController.Length(); i++) {
    NS_WARN_IF(NS_FAILED(mService->
      UnregisterSessionListener(mSessionIdsAtController[i], nsIPresentationService::ROLE_CONTROLLER)));
  }
  mSessionIdsAtController.Clear();

  for (uint32_t i = 0; i < mSessionIdsAtReceiver.Length(); i++) {
    NS_WARN_IF(NS_FAILED(mService->
      UnregisterSessionListener(mSessionIdsAtReceiver[i], nsIPresentationService::ROLE_RECEIVER)));
  }
  mSessionIdsAtReceiver.Clear();

  for (uint32_t i = 0; i < mWindowIds.Length(); i++) {
    NS_WARN_IF(NS_FAILED(mService->UnregisterRespondingListener(mWindowIds[i])));
  }
  mWindowIds.Clear();

  mService->UnregisterAvailabilityListener(this);
  mService = nullptr;
}

bool
PresentationParent::RecvPPresentationRequestConstructor(
  PPresentationRequestParent* aActor,
  const PresentationIPCRequest& aRequest)
{
  PresentationRequestParent* actor = static_cast<PresentationRequestParent*>(aActor);

  nsresult rv = NS_ERROR_FAILURE;
  switch (aRequest.type()) {
    case PresentationIPCRequest::TStartSessionRequest:
      rv = actor->DoRequest(aRequest.get_StartSessionRequest());
      break;
    case PresentationIPCRequest::TSendSessionMessageRequest:
      rv = actor->DoRequest(aRequest.get_SendSessionMessageRequest());
      break;
    case PresentationIPCRequest::TCloseSessionRequest:
      rv = actor->DoRequest(aRequest.get_CloseSessionRequest());
      break;
    case PresentationIPCRequest::TTerminateSessionRequest:
      rv = actor->DoRequest(aRequest.get_TerminateSessionRequest());
      break;
    default:
      MOZ_CRASH("Unknown PresentationIPCRequest type");
  }

  return NS_WARN_IF(NS_FAILED(rv)) ? false : true;
}

PPresentationRequestParent*
PresentationParent::AllocPPresentationRequestParent(
  const PresentationIPCRequest& aRequest)
{
  MOZ_ASSERT(mService);
  RefPtr<PresentationRequestParent> actor = new PresentationRequestParent(mService);
  return actor.forget().take();
}

bool
PresentationParent::DeallocPPresentationRequestParent(
  PPresentationRequestParent* aActor)
{
  RefPtr<PresentationRequestParent> actor =
    dont_AddRef(static_cast<PresentationRequestParent*>(aActor));
  return true;
}

bool
PresentationParent::Recv__delete__()
{
  return true;
}

bool
PresentationParent::RecvRegisterAvailabilityHandler()
{
  MOZ_ASSERT(mService);
  NS_WARN_IF(NS_FAILED(mService->RegisterAvailabilityListener(this)));
  return true;
}

bool
PresentationParent::RecvUnregisterAvailabilityHandler()
{
  MOZ_ASSERT(mService);
  NS_WARN_IF(NS_FAILED(mService->UnregisterAvailabilityListener(this)));
  return true;
}

/* virtual */ bool
PresentationParent::RecvRegisterSessionHandler(const nsString& aSessionId,
                                               const uint8_t& aRole)
{
  MOZ_ASSERT(mService);

  // Validate the accessibility (primarily for receiver side) so that a
  // compromised child process can't fake the ID.
  if (NS_WARN_IF(!static_cast<PresentationService*>(mService.get())->
                  IsSessionAccessible(aSessionId, aRole, OtherPid()))) {
    return true;
  }

  if (nsIPresentationService::ROLE_CONTROLLER == aRole) {
    mSessionIdsAtController.AppendElement(aSessionId);
  } else {
    mSessionIdsAtReceiver.AppendElement(aSessionId);
  }
  NS_WARN_IF(NS_FAILED(mService->RegisterSessionListener(aSessionId, aRole, this)));
  return true;
}

/* virtual */ bool
PresentationParent::RecvUnregisterSessionHandler(const nsString& aSessionId,
                                                 const uint8_t& aRole)
{
  MOZ_ASSERT(mService);
  if (nsIPresentationService::ROLE_CONTROLLER == aRole) {
    mSessionIdsAtController.RemoveElement(aSessionId);
  } else {
    mSessionIdsAtReceiver.RemoveElement(aSessionId);
  }
  NS_WARN_IF(NS_FAILED(mService->UnregisterSessionListener(aSessionId, aRole)));
  return true;
}

/* virtual */ bool
PresentationParent::RecvRegisterRespondingHandler(const uint64_t& aWindowId)
{
  MOZ_ASSERT(mService);

  mWindowIds.AppendElement(aWindowId);
  NS_WARN_IF(NS_FAILED(mService->RegisterRespondingListener(aWindowId, this)));
  return true;
}

/* virtual */ bool
PresentationParent::RecvUnregisterRespondingHandler(const uint64_t& aWindowId)
{
  MOZ_ASSERT(mService);
  mWindowIds.RemoveElement(aWindowId);
  NS_WARN_IF(NS_FAILED(mService->UnregisterRespondingListener(aWindowId)));
  return true;
}

NS_IMETHODIMP
PresentationParent::NotifyAvailableChange(bool aAvailable)
{
  if (NS_WARN_IF(mActorDestroyed || !SendNotifyAvailableChange(aAvailable))) {
    return NS_ERROR_FAILURE;
  }
  return NS_OK;
}

NS_IMETHODIMP
PresentationParent::NotifyStateChange(const nsAString& aSessionId,
                                      uint16_t aState)
{
  if (NS_WARN_IF(mActorDestroyed ||
                 !SendNotifySessionStateChange(nsString(aSessionId), aState))) {
    return NS_ERROR_FAILURE;
  }
  return NS_OK;
}

NS_IMETHODIMP
PresentationParent::NotifyMessage(const nsAString& aSessionId,
                                  const nsACString& aData)
{
  if (NS_WARN_IF(mActorDestroyed ||
                 !SendNotifyMessage(nsString(aSessionId), nsCString(aData)))) {
    return NS_ERROR_FAILURE;
  }
  return NS_OK;
}

NS_IMETHODIMP
PresentationParent::NotifySessionConnect(uint64_t aWindowId,
                                         const nsAString& aSessionId)
{
  if (NS_WARN_IF(mActorDestroyed ||
                 !SendNotifySessionConnect(aWindowId, nsString(aSessionId)))) {
    return NS_ERROR_FAILURE;
  }
  return NS_OK;
}

bool
PresentationParent::RecvNotifyReceiverReady(const nsString& aSessionId,
                                            const uint64_t& aWindowId)
{
  MOZ_ASSERT(mService);

  // Set window ID to 0 since the window is from content process.
  NS_WARN_IF(NS_FAILED(mService->NotifyReceiverReady(aSessionId, aWindowId)));
  return true;
}

/*
 * Implementation of PresentationRequestParent
 */

NS_IMPL_ISUPPORTS(PresentationRequestParent, nsIPresentationServiceCallback)

PresentationRequestParent::PresentationRequestParent(nsIPresentationService* aService)
  : mActorDestroyed(false)
  , mService(aService)
{
  MOZ_COUNT_CTOR(PresentationRequestParent);
}

PresentationRequestParent::~PresentationRequestParent()
{
  MOZ_COUNT_DTOR(PresentationRequestParent);
}

void
PresentationRequestParent::ActorDestroy(ActorDestroyReason aWhy)
{
  mActorDestroyed = true;
  mService = nullptr;
}

nsresult
PresentationRequestParent::DoRequest(const StartSessionRequest& aRequest)
{
  MOZ_ASSERT(mService);

  // Set window ID to 0 since the window is from content process.
  return mService->StartSession(aRequest.url(), aRequest.sessionId(),
                                aRequest.origin(), aRequest.deviceId(),
                                aRequest.windowId(), this);
}

nsresult
PresentationRequestParent::DoRequest(const SendSessionMessageRequest& aRequest)
{
  MOZ_ASSERT(mService);

  // Validate the accessibility (primarily for receiver side) so that a
  // compromised child process can't fake the ID.
  if (NS_WARN_IF(!static_cast<PresentationService*>(mService.get())->
                  IsSessionAccessible(aRequest.sessionId(), aRequest.role(), OtherPid()))) {
    return NotifyError(NS_ERROR_DOM_SECURITY_ERR);
  }

  nsresult rv = mService->SendSessionMessage(aRequest.sessionId(),
                                             aRequest.role(),
                                             aRequest.data());
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return NotifyError(rv);
  }
  return NotifySuccess();
}

nsresult
PresentationRequestParent::DoRequest(const CloseSessionRequest& aRequest)
{
  MOZ_ASSERT(mService);

  // Validate the accessibility (primarily for receiver side) so that a
  // compromised child process can't fake the ID.
  if (NS_WARN_IF(!static_cast<PresentationService*>(mService.get())->
                  IsSessionAccessible(aRequest.sessionId(), aRequest.role(), OtherPid()))) {
    return NotifyError(NS_ERROR_DOM_SECURITY_ERR);
  }

  nsresult rv = mService->CloseSession(aRequest.sessionId(), aRequest.role());
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return NotifyError(rv);
  }
  return NotifySuccess();
}

nsresult
PresentationRequestParent::DoRequest(const TerminateSessionRequest& aRequest)
{
  MOZ_ASSERT(mService);

  // Validate the accessibility (primarily for receiver side) so that a
  // compromised child process can't fake the ID.
  if (NS_WARN_IF(!static_cast<PresentationService*>(mService.get())->
                  IsSessionAccessible(aRequest.sessionId(), aRequest.role(), OtherPid()))) {
    return NotifyError(NS_ERROR_DOM_SECURITY_ERR);
  }

  nsresult rv = mService->TerminateSession(aRequest.sessionId(), aRequest.role());
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return NotifyError(rv);
  }
  return NotifySuccess();
}

NS_IMETHODIMP
PresentationRequestParent::NotifySuccess()
{
  return SendResponse(NS_OK);
}

NS_IMETHODIMP
PresentationRequestParent::NotifyError(nsresult aError)
{
  return SendResponse(aError);
}

nsresult
PresentationRequestParent::SendResponse(nsresult aResult)
{
  if (NS_WARN_IF(mActorDestroyed || !Send__delete__(this, aResult))) {
    return NS_ERROR_FAILURE;
  }

  return NS_OK;
}
