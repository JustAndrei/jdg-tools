$(function() {
    var today = new Date();
    $('#selRateRange')
        .append(rateRanges.map((o, i, a) => {
            var $option = $('<option value="' + i + '">' + o.name + (o.estimate ? ' (прогноз)' : '') + '</option>');
            if (new Date(o.from) <= today && today <= new Date(o.to)) {
                $option.attr('selected', 'selected');
            }
            return $option;
        }));
    $('#selRateRange, #selMode, #selExemption, #selAnnualIncomeRate, #selChorobowa, #cbVacation').change(e => render());
    $('#monthlyIncome').on('input', render);
    loadSettings();
    render();
});

function calculateZdrowotna(mode, rateRange) {
    if (mode == 'ryczalt') return calculateZdrowotnaForRyczalt(rateRange);

    var monthlyIncome = $('#monthlyIncome').val();

    var minZdrowotna = round(rateRange.minIncome * 0.09);

    var pc = mode == 'skala' ? 0.09 : 0.049;
    var zdrowotna = Math.max(minZdrowotna, round(monthlyIncome * pc));

    return [minZdrowotna, zdrowotna, zdrowotna];
}

function calculateZdrowotnaForRyczalt(rateRange) {
    var currentAnnualIncomeRate = $('#selAnnualIncomeRate').val() / 100;
    var maxAnnualIncomeRate = $('#selAnnualIncomeRate option:last').val() / 100;

    var zdrowotna = round(rateRange.factualAverageIncome * 0.09 * currentAnnualIncomeRate);
    var maxZdrowotna = round(rateRange.factualAverageIncome * 0.09 * maxAnnualIncomeRate);

    return [0, zdrowotna, maxZdrowotna];
}

function calculateSpoleczna(rateRange, exemption, percent) {
    return (
        exemption == 0 ? rateRange.expectedAverageIncome * 0.6 * percent / 100 :
        exemption == 1 ? rateRange.minIncome * 0.3 * percent / 100 :
        0
    );
}

function round(value) {
    return Math.round(value * 100) / 100;
}

const moneyFormatter = Intl.NumberFormat('pl-PL', { style: "currency", currency: "PLN" }); // { minimumFractionDigits: 2 });
function money(value) {
    return moneyFormatter.format(value);
}

function render() {
    var mode = $('#selMode').val();
    $('.mode-specific').hide();
    $(`.mode-${mode}`).show();
    var rateRange = rateRanges[$('#selRateRange').val()];
    var exemption = $('#selExemption').val();
    var chorobowaFactor = $('#selChorobowa').val();
    var vacationAvailable = rateRange.vacationAvailable && exemption != 2;
    $('#cbVacation').prop('disabled', !vacationAvailable);
    if (!vacationAvailable) $('#cbVacation').prop('checked', false);
    var vacation = $('#cbVacation').prop('checked');
    var vacationFactor = vacation ? 0 : 1;
    $('#exemptionComment').text($('#selExemption option:selected').data('comment'));
    var noExemption = 0;

    var [minZdrowotna, zdrowotna, maxZdrowotna] = calculateZdrowotna(mode, rateRange);

    var emerytalna = round(calculateSpoleczna(rateRange, exemption, 19.52));
    var maxEmerytalna = round(calculateSpoleczna(rateRange, noExemption, 19.52));

    var rentowa = round(calculateSpoleczna(rateRange, exemption, 8));
    var maxRentowa = round(calculateSpoleczna(rateRange, noExemption, 8));

    var wypadkowa = round(calculateSpoleczna(rateRange, exemption, 1.67));
    var maxWypadkowa = round(calculateSpoleczna(rateRange, noExemption, 1.67));

    var chorobowa = chorobowaFactor * round(calculateSpoleczna(rateRange, exemption, 2.45));
    var maxChorobowa = round(calculateSpoleczna(rateRange, noExemption, 2.45));

    var nfp = round(exemption == 0 ? calculateSpoleczna(rateRange, exemption, 2.45) : 0);
    var maxNfp = round(calculateSpoleczna(rateRange, noExemption, 2.45));

    var spoleczne = round(emerytalna + rentowa + wypadkowa + chorobowa);
    var maxSpoleczne = round(maxEmerytalna + maxRentowa + maxWypadkowa + maxChorobowa);

    var allButZdrowotna = spoleczne + nfp;

    var total = round(zdrowotna + vacationFactor*(spoleczne + nfp));
    var maxTotal = round(maxZdrowotna + maxSpoleczne + maxNfp);

    var width = $('label[for=zdrowotna]').parent().prop('clientWidth');

    $('#estimate-warning').toggle(rateRange.estimate);

    $('.minZdrowotna').text(money(minZdrowotna));
    $('#zdrowotna').text(money(zdrowotna));
    $('label[for=zdrowotna]').css('width', zdrowotna / maxZdrowotna * width);
    $('#zdrowotna-in-all').css('width', zdrowotna / maxTotal * width);

    $('#emerytalna').text(money(emerytalna));
    $('label[for=emerytalna]').css('width', emerytalna / maxEmerytalna * width);
    $('#emerytalna-in-all').css('width', vacationFactor * emerytalna / maxTotal * width);

    $('#rentowa').text(money(rentowa));
    $('label[for=rentowa]').css('width', rentowa / maxRentowa * width);
    $('#rentowa-in-all').css('width', vacationFactor * rentowa / maxTotal * width);

    $('#wypadkowa').text(money(wypadkowa));
    $('label[for=wypadkowa]').css('width', wypadkowa / maxWypadkowa * width);
    $('#wypadkowa-in-all').css('width', vacationFactor * wypadkowa / maxTotal * width);

    $('#chorobowa').text(money(chorobowa));
    $('label[for=chorobowa]').css('width', chorobowa / maxChorobowa * width);
    $('#chorobowa-in-all').css('width', vacationFactor * chorobowa / maxTotal * width);

    $('#nfp').text(money(nfp));
    $('label[for=nfp]').css('width', nfp / maxNfp * width);
    $('#nfp-in-all').css('width', vacationFactor * nfp / maxTotal * width);

    $('#allButZdrowotna').text(money(allButZdrowotna));
    $('#allButZdrowotna-box').toggleClass('estimate', vacation);

    $('#total').text(money(total));

    $('#selChorobowa').toggle(exemption != 2);
    $('#chorobowaNA').toggle(exemption == 2);

    saveSettings();
}

function loadSettings() {
    if (localStorage.zus_exemption == 3) localStorage.zus_exemption = 0; // fix the previously allowed value

    $('#selMode').val(localStorage.zus_mode || 'ryczalt');
    $('#selExemption').val(localStorage.zus_exemption || 2);
    $('#selAnnualIncomeRate').val(localStorage.zus_annualIncomeRate || 60);
    $('#monthlyIncome').val(localStorage.zus_monthlyIncome || 10000);
    $('#selChorobowa').val(localStorage.zus_chorobowa || 0);
}

function saveSettings() {
    localStorage.zus_mode = $('#selMode').val();
    localStorage.zus_exemption = $('#selExemption').val();
    localStorage.zus_annualIncomeRate = $('#selAnnualIncomeRate').val();
    localStorage.zus_monthlyIncome = $('#monthlyIncome').val();
    localStorage.zus_chorobowa = $('#selChorobowa').val();
}
