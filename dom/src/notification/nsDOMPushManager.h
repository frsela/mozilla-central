/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set sw=2 ts=2 autoindent cindent expandtab: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef __MOZILLA_DOM_NETWORK_NOTIFICATION_H_
#define __MOZILLA_DOM_NETWORK_NOTIFICATION_H_

#include "nsCOMPtr.h"
#include "nsCOMArray.h"
#include "nsWeakPtr.h"
#include "nsWeakReference.h"
#include "nsAutoPtr.h"
#include "nsString.h"
#include "nsServiceManagerUtils.h"
#include "nsIDOMDOMRequest.h"
#include "nsIDOMNavigatorPushNotification.h"
#include "nsIPushNotification.h"
#include "nsIContentPermissionPrompt.h"

#define DOMPUSHNOTIFICATION_NAMESPACE \
namespace mozilla { \
namespace dom {
#define DOMPUSHNOTIFICATION_NAMESPACE_END \
} \
}

class nsIPushManager;
class nsIPushNotificationRequest;
class nsPIDOMWindow;
class nsIURI;
class nsIPrincipal;

DOMPUSHNOTIFICATION_NAMESPACE

class RequestCallback;

/**
 * Implements navigator.pushNotification for all windows.
 */
class nsDOMPushManager : public nsIDOMPushManager
                       , public nsSupportsWeakReference {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIDOMPUSHMANAGER

  nsDOMPushManager(nsPIDOMWindow *aWindow);

  void Shutdown() {
    if (mRegistered) {
      UnregisterPushNotification();
    }
  };

  static nsDOMPushManager *Create(nsPIDOMWindow *aWindow);

private:
  friend class ContentPermissionRequest;

  nsWeakPtr mWindow;
  nsCString mManifestURL;
  bool mRegistered;
  nsRefPtr<RequestCallback> mURLRequestCallback;
  nsCString mWAToken;           // used by nsIContentPermissionRequest::Allow

  nsresult PrepareCallback();
  PRUint32 CheckRequestPermission();

  already_AddRefed<nsIPushNotification> getPushNotificationService();

  nsresult GetCurrentRequestURL(const nsACString &aToken,
                                nsIDOMDOMRequest **aRequest);
  nsresult GetManifestURL(char **aManifestURL);
  nsresult GetURI(nsIURI **aURI);
  nsresult UnregisterPushNotification();

  nsresult AskPermissionPrompt(const nsACString &aToken,
                               nsIDOMDOMRequest **aRequest);
  nsresult SendDeniedError(const nsACString &aToken,
                           nsIDOMDOMRequest **aRequest);

  nsresult GetPrincipal(nsIPrincipal **aPrincipal);
};

DOMPUSHNOTIFICATION_NAMESPACE_END

#endif /* __MOZILLA_DOM_NETWORK_NOTIFICATION_H_ */
