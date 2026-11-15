function ensureDialog() {
  let dialog = document.querySelector("#step-town-action-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "step-town-action-dialog";
  dialog.className = "step-town-action-dialog";
  dialog.innerHTML = '<form class="step-town-action-card" method="dialog"><p class="step-town-action-eyebrow">STEP TOWN</p><h2 data-dialog-title></h2><p class="step-town-action-message" data-dialog-message></p><label class="step-town-action-field" data-dialog-field hidden><span data-dialog-label></span><span data-dialog-control></span></label><div class="step-town-action-actions"><button type="button" class="step-town-action-cancel" data-dialog-cancel>Cancel</button><button type="submit" class="step-town-action-confirm" data-dialog-confirm>OK</button></div></form>';
  document.body.append(dialog);
  dialog.addEventListener("click",event=>{
    if (event.target === dialog) dialog.close("cancel");
  });
  return dialog;
}

function openStepTownDialog({title="Please confirm",message="",confirmText="OK",cancelText="Cancel",danger=false,fieldLabel="",value="",placeholder="",inputType="text",options=null,min=null,step=null,required=false}={}) {
  return new Promise(resolve=>{
    const dialog = ensureDialog();
    const form = dialog.querySelector("form");
    const titleNode = dialog.querySelector("[data-dialog-title]");
    const messageNode = dialog.querySelector("[data-dialog-message]");
    const field = dialog.querySelector("[data-dialog-field]");
    const label = dialog.querySelector("[data-dialog-label]");
    const controlHost = dialog.querySelector("[data-dialog-control]");
    const confirm = dialog.querySelector("[data-dialog-confirm]");
    const cancel = dialog.querySelector("[data-dialog-cancel]");
    titleNode.textContent = title;
    messageNode.textContent = message;
    confirm.textContent = confirmText;
    cancel.textContent = cancelText;
    confirm.classList.toggle("danger",danger);
    controlHost.replaceChildren();
    field.hidden = !fieldLabel;
    label.textContent = fieldLabel;

    let control = null;
    if (fieldLabel) {
      if (Array.isArray(options) && options.length) {
        control = document.createElement("select");
        for (const option of options) {
          const node = document.createElement("option");
          node.value = String(option.value);
          node.textContent = String(option.label);
          control.append(node);
        }
        control.value = String(value ?? "");
      } else if (inputType === "textarea") {
        control = document.createElement("textarea");
        control.rows = 3;
        control.value = String(value ?? "");
        control.placeholder = placeholder;
      } else {
        control = document.createElement("input");
        control.type = inputType;
        control.value = String(value ?? "");
        control.placeholder = placeholder;
      }
      if (min !== null && "min" in control) control.min = String(min);
      if (step !== null && "step" in control) control.step = String(step);
      control.required = Boolean(required);
      controlHost.append(control);
    }

    const finish = result => {
      if (dialog.open) dialog.close(result === null ? "cancel" : "confirm");
    };
    const onClose = () => {
      const accepted = dialog.returnValue === "confirm";
      const result = accepted ? (fieldLabel ? control.value : true) : null;
      dialog.removeEventListener("close",onClose);
      resolve(result);
    };
    dialog.addEventListener("close",onClose);
    form.onsubmit = event => {
      event.preventDefault();
      if (control && !control.reportValidity()) return;
      finish(fieldLabel ? control?.value ?? "" : true);
    };
    cancel.onclick = () => finish(null);
    dialog.showModal();
    if (control) {
      control.focus();
      if (control.select && inputType !== "select") control.select();
    } else confirm.focus();
  });
}

export function confirmStepTown(message,{title="Please confirm",confirmText="OK",cancelText="Cancel",danger=false}={}) {
  return openStepTownDialog({title,message,confirmText,cancelText,danger});
}

export function promptStepTown(message,{title="Enter details",fieldLabel="Value",value="",placeholder="",inputType="text",options=null,min=null,step=null,required=false,confirmText="OK",cancelText="Cancel"}={}) {
  return openStepTownDialog({title,message,fieldLabel,value,placeholder,inputType,options,min,step,required,confirmText,cancelText});
}
