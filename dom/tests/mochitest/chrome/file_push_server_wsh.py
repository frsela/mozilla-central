from mod_pywebsocket import msgutil
import json

decoder = json.JSONDecoder()
encoder = json.JSONEncoder()

WATOKEN = "f82d7a74d20cde480d44ee32f24743a8"
UATOKEN = "42a1a133f6eb67a3c0c09994378d5e15"

class handlers(object):
    def registerUA(msg_obj):
        if msg_obj["data"]["uatoken"] == UATOKEN:
            ret_obj = {"status": "REGISTERED"}
        else:
            ret_obj = {"status": "ERROR"}
            pass
        return [ret_obj]
    
    def registerWA(msg_obj):
        if msg_obj["data"]["uatoken"] == UATOKEN and \
           msg_obj["data"]["watoken"] == WATOKEN:
            ret_obj = {"status": "REGISTERED",
                       "url": "http://push.example.com/push",
                       "messageType": "registerWA"}
        else:
            ret_obj = {"status": "ERROR"}
            pass
        
        notify_obj = {"messageType": "notification",
                      "id": WATOKEN,
                      "message": {
                          "title": "test message",
                          "description": "description"},
                      "signature": "signature",
                      "ttl": 0,
                      "timestamp": 0,
                      "priority": 1}
        
        return [ret_obj, notify_obj]

    def getAllMessages(msg):
        pass
    pass

def web_socket_do_extra_handshake(request):
  # must set request.ws_protocol to the selected version from ws_requested_protocols
  request.ws_protocol = request.ws_requested_protocols[0]

  if (request.ws_protocol == 'error'):
      raise ValueError('Error')
  pass

def transfer_data(req):
    msg = req.ws_stream.receive_message()
    if not msg:
        return True
    msg_obj = decoder.decode(msg)
    cmd = msg_obj["messageType"]
    handler = handlers.__dict__[cmd]
    rets = handler(msg_obj)
    if rets:
        for ret in rets:
            output_msg = encoder.encode(ret)
            req.ws_stream.send_message(output_msg)
            pass
        pass
    pass

def web_socket_transfer_data(req):
    while True:
        close = transfer_data(req)
        if close:
            break
        pass
    pass
