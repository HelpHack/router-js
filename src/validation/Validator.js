const ClientErrorUtils = require("../utils/ClientErrorUtils.js");

const validateNip = nip => {
  if (typeof nip !== 'string') return false;
  nip = nip.replace(/[\ \-]/gi, '');
  const weight = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  const controlNumber = parseInt(nip.substring(9, 10));
  for (let i = 0; i < weight.length; i++) {
    sum += parseInt(nip.substring(i, i + 1)) * weight[i];
  }
  return sum % 11 === controlNumber;
};

class Validator{
  constructor(customDataOptions={}){

    this.dataOptions = Object.assign({
      isRequired: value => !!value,
      longerThan: (value, min) => value.length && value.length > min,
      shorterThan: (value, max) => value.length && value.length < max,
      greaterThan: (value, min) => value > min,
      smallerThan: (value, max) => value < max,
      oneOf: (value, options) => options.includes(value),
    }, customDataOptions);

    this.dataTypes = {
      shape: this.createDataType('shape'),
      arrayOf: this.createDataType('arrayOf'),
      oneOfType: this.createDataType('oneOfType'),
      string: this.createDataType('string', value => {
        const newValue = String(value);
        return { valid: true, newValue };
      }),
      int: this.createDataType('int', value => {
        const newValue = parseInt(value);
        return { valid: !isNaN(newValue), newValue };
      }),
      float: this.createDataType('float', value => {
        const newValue = parseFloat(value);
        return { valid: !isNaN(newValue), newValue };
      }),
      email: this.createDataType('email', value => {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return { valid: re.test(value), newValue: value };
      }),
      nip: this.createDataType('nip', value => {
        return { valid: validateNip(value), newValue: value };
      }),
    };

    this.pushTypeError = this.pushTypeError.bind(this);
    this.createDataType = this.createDataType.bind(this);
    this.addDataType = this.addDataType.bind(this);
    this.validate = this.validate.bind(this);
  }

  pushTypeError (errors, property, validator){
    const options = validator.options ? Object.keys(validator.options) : [];
    const { name, parentPath } = property;
    const optionString = options.length ? `( ${options.join(', ')} )` : '';
    errors.push(`Property '${parentPath?parentPath+' ':''}${name}' does not match type '${validator.name}' ${optionString}`);
  }

  createEmptyDataError (parrentPath) {
    const message = parrentPath ? `Property ${parrentPath} is undefined` : 'Data is empty, but expected object';
    return { valid: false, errors: [message], output: null };
  }

  addDataType(name, validate){
    this.dataTypes[name] = this.createDataType(name, validate);
  }

  createDataType(name, validate){
    return (options = {}, functionalTypesOptions = {}) => {
      return {
        name,
        options,
        functionalTypesOptions,
        validate: value => {
          let valid = true;
          if (options) {
            if (!options.isRequired && !value) return { valid: true };

            Object.keys(options).forEach(o => {
              const param = options[o];
              valid = this.dataOptions[o](value, param);
            });
          }

          if (valid) {
            return validate(value);
          }
          return { valid: false, newValue: value };
        },
      };
    };
  }

  validate(data, definitions, parentPath = ''){
    if (!data) return this.createEmptyDataError(parentPath);
    let errors = [];
    const output = {};

    Object.keys(definitions).forEach(k => {
      const value = data[k];
      const validator = definitions[k];
      switch (validator.name) {
        case 'shape': {
          if (!value) {
            if (validator.functionalTypesOptions.isRequired) errors.push(`${parentPath} ${k} is missing`);
          } else {
            const innerValidationResult = this.validate(value, validator.options, `${parentPath} ${k} >`);
            errors = errors.concat(innerValidationResult.errors);
          }
          break;
        }
        case 'arrayOf': {
          if (!value) {
            if (validator.functionalTypesOptions.isRequired) errors.push(`${parentPath} ${k} is missing`);
          } else if (Array.isArray(value)) {
            const innerValidationResults = value.map((item, i) => {
              return this.validate({ item }, { item: validator.options }, `${parentPath} ${k}(${i}) >`);
            });
            output[k] = [];
            innerValidationResults.forEach((result, i) => {
              output[k][i] = result.output.item;
              errors = errors.concat(result.errors);
            });
          } else {
            this.pushTypeError(errors, { name: k, parentPath }, validator);
          }
          break;
        }
        case 'oneOfType':{
          const typeValidations = validator.options.map(o=>this.validate({[k]:value},{[k]:o} ,`${parentPath} ${k} >`));
          const validTypes = typeValidations.filter(v=>v.valid);
          if(validTypes.length){
            output[k] = validTypes[0].output[k];
          }else{
            if (validator.functionalTypesOptions.isRequired) errors.push(`${parentPath} ${k} is not valid for any of types ${validator.options.map(o=>o.name)}`);
          }
          break;
        }
        default: {
          const result = validator.validate(value);
          output[k] = result.newValue;
          if (!result.valid) {
            this.pushTypeError(errors, { name: k, parentPath }, validator);
          }
        }
      }
    });
    if(errors.length && parentPath==='') throw ClientErrorUtils.createClientError(400, {errors});
    return { valid: errors.length === 0, errors, output };
  }
}

module.exports = Validator;
