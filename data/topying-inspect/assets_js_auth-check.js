function showPasswordVerificationModal() {
  $('<div id="verify-modal" class="modal fade modal-primary in" aria-hidden="false" isbindmv="1">' +
    '<div class="modal-dialog">' +
    '<div class="modal-content">' +
    '<div class="modal-header">' +
    '<h4 class="modal-title">'+$.i18n("page.login.img.ver.tip")+'</h4>' +
    '</div>' +
    '<div class="modal-body">' +
    '<p style="font-size: 16px;margin-bottom: 10px;"><code>'+$.i18n("detected_abnormal_login_behavior_please_verify_password_tip")+'</code></p>' +
    '<input type="password" id="verify-password" class="form-control mb-3" placeholder="'+$.i18n("db.tbCfrmUser.password.help")+'" maxlength="64" style="height: 46px;">' +
    '<div class="row">' +
    '<div class="col-md-6">' +
    '<input type="text" id="verify-code" class="form-control" placeholder="'+$.i18n("forgetPwd.smsVerCode.help")+'" maxlength="4" style="height: 46px;">' +
    '</div>' +
    '<div class="col-md-6">' +
    '<div class="text-center py-2" style="cursor: pointer;"><img title="Captcha" id="verify-code-img" style="cursor: pointer;width:90px;" height="32"></div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
    '<button id="verify-btn" class="btn btn-primary">'+$.i18n("confirm")+'</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>').appendTo('body').modal({backdrop: 'static'});

      // 点击刷新验证码
      $('#verify-code-img').on('click', function() { 
    	  $(this).attr("src", window.PATH + "/verify/loadVerify.ajax?random=" + Math.random());
      });
      
      // 确认按钮
	  $('#verify-btn').on('click', function() {
		    var password = $('#verify-password').val();
		    var inputCode = $('#verify-code').val();
		    if(password.trim() == "" || inputCode.trim() == ""){
		    	layer.msg.error($.i18n("please_ipt_pwd_code"));
		    }else{
		    	verifyPassword(password, inputCode);
		    }
	  });
  
      $('#verify-code-img').click();
}
 

// 验证密码
function verifyPassword(password, inputCode) {
	var check_code = getEncryptData(hex_md5(password) + "-|-" + inputCode);
	$.ajax({
	    url: window.PATH + '/verify-password',
	    method: 'POST',
	    data: { check_code: check_code },
	    success: function(res) {
    	  if(res.state==0){
    		  if(res.data.errcode == 0 || (res.data.errcode !=0 && res.data.remainingAttempts <=0)){
    			  location.reload();
    		  }else{
    			  $('#verify-password').val("");
    			  $('#verify-code').val("");
    			  $('#verify-code-img').click();
    	    	  layer.msg.error($.i18n("verification_failed_password_or_captcha_incorrect",res.data.remainingAttempts)); 
    		  }
	      } else {
	    	  $('#verify-password').val("");
			  $('#verify-code').val("");
	    	  $('#verify-code-img').click();
	    	  layer.msg.error($.i18n("verification_failed_password_or_captcha_incorrect",res.data.remainingAttempts));
	      }
	    },
	    error: function() {
	    	location.reload(); 
	    }
	});
}
 