/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set sw=2 ts=2 autoindent cindent expandtab: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsDOMPushManager.h"

#include "jsapi.h"
#include "nsXPCOMStrings.h"
#include "nsCOMArray.h"
#include "nsString.h"
#include "nsXPCOMStrings.h"
#include "nsWeakPtr.h"
#include "nsDOMClassInfoID.h"
#include "nsThreadUtils.h"
#include "nsIPushNotification.h"
#include "nsIDOMDocument.h"
#include "nsIDOMWindow.h"
#include "nsPIDOMWindow.h"
#include "nsIURI.h"
// Get the context from nsIDOMWindow.
#include "nsIScriptGlobalObject.h"
#include "nsIScriptContext.h"
// Get the origin of a nsIDOMWindow.
#include "nsIScriptObjectPrincipal.h"
#include "nsIPrincipal.h"

#include "nsIPermissionManager.h"
#include "nsIDOMWindowUtils.h"
#include "mozIApplication.h"
#include "nsIInterfaceRequestor.h"
#include "nsIInterfaceRequestorUtils.h"
#include "nsIAppsService.h"


#define PERMISSION_REQUEST_PUSH_NOTIFICATION "request-push-notification"

DOMPUSHNOTIFICATION_NAMESPACE

inline jsval
CStringToJsval(JSContext *cx, const nsACString &str) {
  char *cstr = NS_CStringCloneData(str);
  JSString *jsstr = JS_NewStringCopyZ(cx, cstr);
  NS_Free(cstr);
  jsval val = STRING_TO_JSVAL(jsstr);
  return val;
}

inline JSContext *
DOMWindowContext(nsIDOMWindow *aWindow) {
  nsCOMPtr<nsIScriptGlobalObject> global = do_QueryInterface(aWindow);
  NS_ENSURE_TRUE(global, NULL);
  nsCOMPtr<nsIScriptContext> scriptcontext = global->GetContext();
  NS_ENSURE_TRUE(scriptcontext, NULL);
  JSContext *context = scriptcontext->GetNativeContext();

  return context;
}

/**
 * Implement Callbacks for nsIPushNotificationRequest.
 *
 * RequestCallback is responsible for forwarding events, triggered
 * when the request is completed, from nsIPushNotification to the Web
 * APPs through the nsIDOMDOMRequest returned by
 * requestURL() and getCurrentURL() of interface
 * nsIDOMPushManager.
 */
class RequestCallback : public nsIPushNotificationSuccessCallback,
                        public nsIPushNotificationErrorCallback {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIPUSHNOTIFICATIONSUCCESSCALLBACK
  NS_DECL_NSIPUSHNOTIFICATIONERRORCALLBACK

  RequestCallback() {};

  /**
   * Get the nsIDOMDOMRequest for firing success or error events.
   *
   * RequestCallback will create a nsIDOMDOMRequest for firing events
   * when the request is completed.
   */
  nsIDOMDOMRequest *GetDOMRequest() {
    NS_ADDREF(mDOMRequest);
    return mDOMRequest;
  };

  /**
   * This function should be called before any other actions.
   *
   * @param aWindow
   *        is the window for delivering callback.
   *
   * aWindow is used to make sure the target window is still alive
   * when calling callbacks.
   */
  nsresult Init(nsIDOMWindow *aWindow);

  // Called for denied request.
  nsresult SendDeniedError() {
    nsCOMPtr<nsIRunnable> runnable =
      NS_NewRunnableMethod(this, &RequestCallback::SendDeniedErrorRun);
    nsresult rv = NS_DispatchToMainThread(runnable);

    return rv;
  }

  // Called for network error.
  nsresult SendNetworkError() {
    nsCOMPtr<nsIRunnable> runnable =
      NS_NewRunnableMethod(this, &RequestCallback::SendNetworkErrorRun);
    nsresult rv = NS_DispatchToMainThread(runnable);

    return rv;
  }

private:
  nsCOMPtr<nsIDOMDOMRequest> mDOMRequest;
  nsWeakPtr mWindow;

  // Send an error to associated nsIDOMDOMRequest object
  nsresult SendError(const nsAString &error);

  jsval createResult(const nsACString &url,
                     nsACString *versions,
                     int nversions,
                     bool userMessages,
                     bool appMessages,
                     bool appBages);

  nsresult SendDeniedErrorRun() {
    return SendError(NS_LITERAL_STRING("DeniedError"));
  }

  nsresult SendNetworkErrorRun() {
    return SendError(NS_LITERAL_STRING("NetworkError"));
  }
};

NS_IMPL_ISUPPORTS2(RequestCallback,
                   nsIPushNotificationSuccessCallback,
                   nsIPushNotificationErrorCallback)

// nsIPushNotificationSuccessCallback::HandleSuccess()
NS_IMETHODIMP
RequestCallback::HandleSuccess(const nsACString &aURL) {
  nsCOMPtr<nsIDOMWindow> window = do_QueryReferent(mWindow);
  if (!window) {
    return NS_OK;
  }

  // Since we don't define the way of delivering messages, all
  // messages are deliveried to apps directly.  So, all type of
  // messages are allowed here.
  jsval result = createResult(aURL,
                              (nsACString *)nullptr, // versions
                              0,
                              true, // user messages
                              true, // app messages
                              true); // app bages

  nsCOMPtr<nsIDOMRequestService> rs =
    do_GetService("@mozilla.org/dom/dom-request-service;1");
  nsresult rv = rs->FireSuccess(mDOMRequest, result);

  return rv;
}

// nsIPushNotificationErrorCallback::HandleError()
NS_IMETHODIMP
RequestCallback::HandleError() {
  return SendNetworkError();
}

nsresult
RequestCallback::Init(nsIDOMWindow *aWindow) {
  nsCOMPtr<nsIDOMRequestService> rs =
    do_GetService("@mozilla.org/dom/dom-request-service;1");
  nsresult rv = rs->CreateRequest(aWindow, getter_AddRefs(mDOMRequest));
  NS_ENSURE_SUCCESS(rv, rv);
  mWindow = do_GetWeakReference(aWindow);

  return NS_OK;
}

nsresult
RequestCallback::SendError(const nsAString &error) {
  nsCOMPtr<nsIDOMWindow> window = do_QueryReferent(mWindow);
  if (!window) {
    return NS_OK;
  }

  nsCOMPtr<nsIDOMRequestService> rs =
    do_GetService("@mozilla.org/dom/dom-request-service;1");
  
  nsresult rv = rs->FireError(mDOMRequest, error);
  return rv;
}

/**
 * Create a jsval for being the result of an DOMRequest.
 */
jsval
RequestCallback::createResult(const nsACString &url,
                              nsACString *versions,
                              int nversions,
                              bool userMessages,
                              bool appMessages,
                              bool appBages) {
  nsCOMPtr<nsIDOMWindow> window = do_QueryReferent(mWindow);
  JSContext *cx = DOMWindowContext(window);

  JSObject *obj = JS_NewObject(cx, nullptr, nullptr, nullptr);

  JS_DefineProperty(cx, obj, "url", CStringToJsval(cx, url),
                    nullptr, nullptr, JSPROP_READONLY | JSPROP_PERMANENT);

  jsval jsvalVersions;
  if (nversions) {
    jsval *versionVals = (jsval *)NS_Alloc(sizeof(jsval) * nversions);
    for (int i = 0; i < nversions; i++) {
      versionVals[i] = CStringToJsval(cx, versions[i]);
    }
    JSObject *jsversions = JS_NewArrayObject(cx, nversions, versionVals);
    jsvalVersions = OBJECT_TO_JSVAL(jsversions);
    NS_Free(jsversions);
  } else {
    jsvalVersions = JSVAL_NULL;
  }
  JS_DefineProperty(cx, obj, "supportedVersions", jsvalVersions,
                    nullptr, nullptr, JSPROP_READONLY | JSPROP_PERMANENT);

  JS_DefineProperty(cx, obj, "userMessages", BOOLEAN_TO_JSVAL(userMessages),
                    nullptr, nullptr, JSPROP_READONLY | JSPROP_PERMANENT);
  JS_DefineProperty(cx, obj, "appMessages", BOOLEAN_TO_JSVAL(appMessages),
                    nullptr, nullptr, JSPROP_READONLY | JSPROP_PERMANENT);
  JS_DefineProperty(cx, obj, "appBages", BOOLEAN_TO_JSVAL(appBages),
                    nullptr, nullptr, JSPROP_READONLY | JSPROP_PERMANENT);

  return OBJECT_TO_JSVAL(obj);
}


/**
 * Implement nsIContentPermissionRequest.
 *
 * ContentPermissionRequest handles callbacks for a request on
 * nsIContentPermissionPrompt service for asking user if allowing the
 * app's access on push-notification API.
 */
class ContentPermissionRequest : public nsIContentPermissionRequest
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSICONTENTPERMISSIONREQUEST

  ContentPermissionRequest(nsDOMPushManager *aManager) : mManager(aManager) {
    mManagerWeak =
      do_GetWeakReference(static_cast<nsIDOMPushManager*>(aManager));
  }

private:
  nsWeakPtr mManagerWeak;       // make sure mManager is still valid.
  nsDOMPushManager *mManager;

  bool isValidManager() {
    nsCOMPtr<nsIDOMPushManager> manager = do_QueryReferent(mManagerWeak);

    return !!manager;
  }
};

NS_IMPL_ISUPPORTS1(ContentPermissionRequest,
                   nsIContentPermissionRequest)

NS_IMETHODIMP
ContentPermissionRequest::GetType(nsACString &aType) {
  aType = NS_LITERAL_CSTRING("push-notification");
  return NS_OK;
}

NS_IMETHODIMP
ContentPermissionRequest::GetPrincipal(nsIPrincipal **aPrincipal) {
  if (!isValidManager())
    return NS_ERROR_FAILURE;

  return mManager->GetContentPrincipal(aPrincipal);
}

NS_IMETHODIMP
ContentPermissionRequest::GetWindow(nsIDOMWindow **aWindow) {
  if (!isValidManager())
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsPIDOMWindow> window = do_QueryReferent(mManager->mWindow);
  window.forget(aWindow);
  return NS_OK;
}

NS_IMETHODIMP
ContentPermissionRequest::GetElement(nsIDOMElement **aElement) {
  return NS_ERROR_FAILURE;
}

NS_IMETHODIMP
ContentPermissionRequest::Cancel() {
  if (!isValidManager())
    return NS_OK;

  nsresult rv = mManager->mURLRequestCallback->SendDeniedError();
  return rv;
}

NS_IMETHODIMP
ContentPermissionRequest::Allow() {
  if (!isValidManager())
    return NS_OK;

  nsCOMPtr<nsIDOMDOMRequest> request;
  // mWAToken was assigned by AskPermissionPrompt().
  nsresult rv = mManager->GetCurrentRequestURL(mManager->mWAToken,
                                               getter_AddRefs(request));
  return rv;
}


// nsDOMPushManager

NS_INTERFACE_MAP_BEGIN(nsDOMPushManager)
  NS_INTERFACE_MAP_ENTRY_AMBIGUOUS(nsISupports, nsIDOMPushManager)
  NS_INTERFACE_MAP_ENTRY(nsIDOMPushManager)
  NS_INTERFACE_MAP_ENTRY(nsISupportsWeakReference)
  NS_DOM_INTERFACE_MAP_ENTRY_CLASSINFO(PushManager)
NS_INTERFACE_MAP_END

NS_IMPL_ADDREF(nsDOMPushManager)
NS_IMPL_RELEASE(nsDOMPushManager)

inline
nsDOMPushManager::nsDOMPushManager(nsPIDOMWindow *aWindow) :
  mWindow(do_GetWeakReference(aWindow)),
  mRegistered(false) {
}

nsDOMPushManager *
nsDOMPushManager::Create(nsPIDOMWindow *aWindow) {
  return new nsDOMPushManager(aWindow);
}

inline nsresult
nsDOMPushManager::PrepareCallback() {
  nsresult rv;

  if (mURLRequestCallback) {
    return NS_OK;
  }

  // Path of dispatching request callbacks.
  // nsIPushNotificationRequest -> RequestCallback -> nsIDOMDOMRequest
  nsRefPtr<RequestCallback> callback = new RequestCallback();
  nsCOMPtr<nsPIDOMWindow> window = do_QueryReferent(mWindow);
  NS_ASSERTION(window, "lost the reference to the window.");
  rv = callback->Init(window);
  NS_ENSURE_SUCCESS(rv, rv);

  mURLRequestCallback = callback;

  return NS_OK;
}

inline PRUint32
nsDOMPushManager::CheckRequestPermission() {
  return nsIPermissionManager::ALLOW_ACTION;
  nsresult rv;

  nsCOMPtr<nsIPermissionManager> permissionManager =
    do_GetService(NS_PERMISSIONMANAGER_CONTRACTID);
  if (!permissionManager) {
    return nsIPermissionManager::DENY_ACTION;
  }

  nsCOMPtr<nsIURI> uri;
  rv = GetURI(getter_AddRefs(uri));
  if (NS_FAILED(rv)) {
    return nsIPermissionManager::DENY_ACTION;
  }
  if (!uri) {                   // "[System Principal]"
    return nsIPermissionManager::ALLOW_ACTION;
  }

  PRUint32 perm;
  rv = permissionManager->TestPermission(uri,
                                         PERMISSION_REQUEST_PUSH_NOTIFICATION,
                                         &perm);
  NS_ENSURE_SUCCESS(rv, nsIPermissionManager::DENY_ACTION);

  return perm;
}

inline already_AddRefed<nsIPushNotification>
nsDOMPushManager::getPushNotificationService() {
  nsCOMPtr<nsIPushNotification> service;

  service = do_GetService("@mozilla.org/network/push-notification;1");
  NS_ASSERTION(!!service,
               "Get push notification service failed");
  return service.forget();
}

// Interface nsIDOMPushManager
// ============================================================

NS_IMETHODIMP
nsDOMPushManager::RequestURL(const nsACString &aToken,
                           nsIDOMDOMRequest **aRequest) {
  /* call nsIPushNotification::RegisterWA() */
  /* - check permission manager
   *   - permission-prompt
   */
  nsresult rv;

  if (!IsApp()) {
    return NS_ERROR_FAILURE;
  }

  mURLRequestCallback = nullptr;

  PRUint32 perm = CheckRequestPermission();
  switch(perm) {
  case nsIPermissionManager::UNKNOWN_ACTION:
    rv = AskPermissionPrompt(aToken, aRequest);
    break;

  case nsIPermissionManager::ALLOW_ACTION:
    rv = GetCurrentRequestURL(aToken, aRequest);
    break;

  case nsIPermissionManager::DENY_ACTION:
    PrepareCallback();
    *aRequest = mURLRequestCallback->GetDOMRequest();
    rv = mURLRequestCallback->SendDeniedError();
    break;

  default:
    rv = NS_ERROR_FAILURE;
    break;
  }

  return rv;
}

NS_IMETHODIMP
nsDOMPushManager::GetCurrentURL(nsIDOMDOMRequest **aRequest) {
  if (!IsApp()) {
    return NS_ERROR_FAILURE;
  }

  /* call nsIPushNotification::GetCurrentPushURL */
  mURLRequestCallback = nullptr;
  return GetCurrentRequestURL(NS_LITERAL_CSTRING(""), // no token
                              aRequest);
}

NS_IMETHODIMP
nsDOMPushManager::RevokeURL(nsIDOMDOMRequest **aRequest) {
  // You can not revoke a registration for current protocol.
  return NS_ERROR_NOT_IMPLEMENTED;
}
/**
 * Call one of RegisterWA or GetCurrentPushURL of nsIPushNotification.
 *
 * @param aToken is not empty to call RegisterWA; otherwise, call
 *        GetCurrentPushURL.
 */
nsresult
nsDOMPushManager::GetCurrentRequestURL(const nsACString &aToken,
                                       nsIDOMDOMRequest **aRequest) {
  nsCString manifestURL;
  nsresult rv = GetAppManifestURL(getter_Copies(manifestURL));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIPushNotification> service = getPushNotificationService();
  /* XXXX: This section of code is noly for testing.  Should be
   * removed later since we are going to monitor network manager to
   * reconnect to notification when any network is available.
   */
  bool connected;
  rv = service->GetConnected(&connected);
  NS_ENSURE_SUCCESS(rv, rv);
  if (!connected) {
    nsCOMPtr<nsIPushNotificationUARequest> uarequest;
    rv = service->RegisterUA(getter_AddRefs(uarequest));
    NS_ENSURE_SUCCESS(rv, rv);
  }
  /* end of testing code */

  nsCOMPtr<nsIPushNotificationWARequest> request;
  if (aToken.IsEmpty()) {
    rv = service->GetCurrentPushURL(manifestURL, getter_AddRefs(request));
  } else {
    nsCOMPtr<nsIURI> pageURI;
    GetURI(getter_AddRefs(pageURI));
    nsCAutoString pageURICStr;
    pageURI->GetSpec(pageURICStr);
    rv = service->RegisterWA(pageURICStr,
                             manifestURL,
                             aToken,
                             getter_AddRefs(request));
  }
  NS_ENSURE_SUCCESS(rv, rv);

  rv = PrepareCallback();
  NS_ENSURE_SUCCESS(rv, rv);

  rv = request->SetOnSuccess(mURLRequestCallback);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = request->SetOnError(mURLRequestCallback);
  NS_ENSURE_SUCCESS(rv, rv);

  *aRequest = mURLRequestCallback->GetDOMRequest();
  mRegistered = true;

  return NS_OK;
}

nsresult
nsDOMPushManager::GetAppManifestURL(char **aManifestURL) {
  if (mManifestURL.IsEmpty()) {
    nsCOMPtr<nsIPrincipal> principal;
    nsresult rv = GetContentPrincipal(getter_AddRefs(principal));
    NS_ENSURE_SUCCESS(rv, rv);

    uint32_t appId;
    rv = principal->GetAppId(&appId);
    NS_ENSURE_SUCCESS(rv, rv);

    nsCOMPtr<nsIAppsService> appsservice =
      do_GetService(APPS_SERVICE_CONTRACTID);

    nsAutoString manifestURL;
    rv = appsservice->GetManifestURLByLocalId(appId, manifestURL);
    NS_ENSURE_SUCCESS(rv, rv);

    mManifestURL = NS_ConvertUTF16toUTF8(manifestURL);
  }

  *aManifestURL = NS_CStringCloneData(mManifestURL);

  return NS_OK;
}

nsresult
nsDOMPushManager::GetURI(nsIURI **aURI) {
  nsCOMPtr<nsIPrincipal> principal;
  nsresult rv = GetContentPrincipal(getter_AddRefs(principal));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = principal->GetURI(aURI);
  NS_ENSURE_SUCCESS(rv, rv);

  return NS_OK;
}

nsresult
nsDOMPushManager::AskPermissionPrompt(const nsACString &aToken,
                                    nsIDOMDOMRequest **aRequest) {
  nsresult rv;

  mWAToken = aToken;

  nsCOMPtr<nsIContentPermissionPrompt> prompt =
    do_GetService(NS_CONTENT_PERMISSION_PROMPT_CONTRACTID);

  nsRefPtr<ContentPermissionRequest> cprequest =
    new ContentPermissionRequest(this);
  rv = prompt->Prompt(cprequest);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = PrepareCallback();
  NS_ENSURE_SUCCESS(rv, rv);

  *aRequest = mURLRequestCallback->GetDOMRequest();

  return NS_OK;
}

nsresult
nsDOMPushManager::GetContentPrincipal(nsIPrincipal **aPrincipal) {
  nsCOMPtr<nsPIDOMWindow> window = do_QueryReferent(mWindow);
  NS_ASSERTION(window, "lost the reference to the window.");
  nsCOMPtr<nsIScriptObjectPrincipal> soprincipal =
    do_QueryInterface(window);
  if (!soprincipal) {
    return NS_ERROR_NULL_POINTER;
  }

  nsCOMPtr<nsIPrincipal> principal = soprincipal->GetPrincipal();
  if (!principal) {
    return NS_ERROR_NULL_POINTER;
  }

  principal.forget(aPrincipal);

  return NS_OK;
}


DOMPUSHNOTIFICATION_NAMESPACE_END

DOMCI_DATA(PushManager, mozilla::dom::nsDOMPushManager)
