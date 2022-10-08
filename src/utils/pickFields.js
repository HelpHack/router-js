const pickFields = (o, ...fields) =>
  fields.reduce((a, x) => {
    if (o.hasOwnProperty(x)) a[x] = o[x];
    return a;
  }, {});


module.exports = pickFields;
